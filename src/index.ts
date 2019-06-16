import { useLayoutEffect, useReducer, useRef } from 'react'
import shallowEqual from './shallowEqual'

export type State = { [key: string]: any } //Record<string, any>
export type StateListener<T extends State, U = T> = (state: U) => void
export type StateSelector<T extends State, U = T> = (state: T) => U
export type PartialState<T extends State> =
  | Partial<T>
  | ((state: T) => Partial<T>)
export type SetState<T extends State> = (partial: PartialState<T>) => void
export type GetState<T extends State> = () => T
export type Destroy = () => void

export interface Subscribe<T> {
  (listener: StateListener<T>): () => void
  <U>(selector: StateSelector<T, U>, listener: StateListener<T, U>): () => void
}
export interface UseStore<T> {
  (): T
  <U>(selector: StateSelector<T, U>, dependencies?: ReadonlyArray<any>): U
}
export interface StoreApi<T> {
  getState: GetState<T>
  setState: SetState<T>
  subscribe: Subscribe<T>
  destroy: Destroy
}

const reducer = <T>(state: any, newState: T) => newState

export default function create<T extends State>(
  createState: (set: SetState<T>, get: GetState<T>) => T
): [UseStore<T>, StoreApi<T>] {
  const listeners: Set<StateListener<T>> = new Set()

  const setState: SetState<T> = partial => {
    const partialState =
      typeof partial === 'function' ? partial(state) : partial
    if (partialState !== state) {
      state = Object.assign({}, state, partialState)
      listeners.forEach(listener => listener(state))
    }
  }

  const getState: GetState<T> = () => state

  // Optional selector param goes first so we can infer its return type and use
  // it for listener
  const subscribe: Subscribe<T> = <U>(
    selectorOrListener: StateListener<T> | StateSelector<T, U>,
    listenerOrUndef?: StateListener<T, U>
  ) => {
    let listener = selectorOrListener
    // Existence of second param means a selector was passed in
    if (listenerOrUndef) {
      // We know selector is not type StateListener so it must be StateSelector
      const selector = selectorOrListener as StateSelector<T, U>
      let stateSlice = selector(state)
      listener = () => {
        const selectedSlice = selector(state)
        if (!shallowEqual(stateSlice, (stateSlice = selectedSlice)))
          listenerOrUndef(stateSlice)
      }
    }
    listeners.add(listener)
    return () => void listeners.delete(listener)
  }

  const destroy: Destroy = () => {
    listeners.clear()
  }

  const useStore: UseStore<T> = <U = T>(
    selector?: StateSelector<T, U>,
    dependencies?: ReadonlyArray<any>
  ): U => {
    const selectorRef = useRef(selector)
    const depsRef = useRef(dependencies)
    let [stateSlice, dispatch] = useReducer(
      reducer,
      state,
      // Optional third argument but required to not be 'undefined'
      selector as StateSelector<T, U>
    )

    // Need to manually get state slice if selector has changed with no deps or
    // deps exist and have changed
    if (
      selector &&
      ((!dependencies && selector !== selectorRef.current) ||
        (dependencies && !shallowEqual(dependencies, depsRef.current)))
    ) {
      stateSlice = selector(state)
    }

    // Update refs synchronously after view has been updated
    useLayoutEffect(() => {
      selectorRef.current = selector
      depsRef.current = dependencies
    }, dependencies || [selector])

    useLayoutEffect(() => {
      return selector
        ? subscribe(
            // Truthy check because it might be possible to set selectorRef to
            // undefined and call this subscriber before it resubscribes
            () => (selectorRef.current ? selectorRef.current(state) : state),
            dispatch
          )
        : subscribe(dispatch)
      // Only resubscribe to the store when changing selector from function to
      // undefined or undefined to function
    }, [!selector])

    return stateSlice
  }

  const api: StoreApi<T> = { destroy, getState, setState, subscribe }
  let state = createState(setState, getState)

  return [useStore, api]
}
