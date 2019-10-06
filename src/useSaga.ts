import { useReducer, useEffect, useRef } from 'react'
import { runSaga, stdChannel, MulticastChannel, Saga } from 'redux-saga'
import { take, call, effectTypes } from 'redux-saga/effects'

function* selectAsyncSaga<S>(
  selector: (state: S, ...args: any[]) => S,
  args: any[]
) {
  const { state }: { state: S } = yield take('REACT_STATE_READY')
  return selector(state, ...args)
}

export function useReducerAndSaga<S, A>(
  reducer: (state: S, action: A) => S,
  state0: S,
  saga: Saga<any[]>,
  sagaOptions: any
) {
  const [state, reactDispatch] = useReducer(reducer, state0)
  const sagaEnv = useRef<{
    channel: MulticastChannel<A | { type: 'REACT_STATE_READY'; state: S }>
    state: S
    pendingActions: A[]
  }>({
    channel: stdChannel(),
    state: state0,
    pendingActions: [],
  })

  function dispatch(action: A) {
    console.log('react dispatch', action)
    reactDispatch(action)
    console.log('post react dispatch', action)
    // dispatch to sagas is done in the commit phase
    sagaEnv.current.pendingActions.push(action)
  }

  useEffect(() => {
    console.log('update saga state')
    // sync with react state, *should* be safe since we're in commit phase
    sagaEnv.current.state = state
    const pendingActions = sagaEnv.current.pendingActions
    // flush any pending actions, since we're in commit phase, reducer
    // should've handled all those actions
    if (pendingActions.length > 0) {
      sagaEnv.current.pendingActions = []
      console.log('flush saga actions')
      pendingActions.forEach(action => sagaEnv.current.channel.put(action))
      sagaEnv.current.channel.put({ type: 'REACT_STATE_READY', state })
    }
  })

  // This is a one-time effect that starts the root saga
  useEffect(() => {
    /* sagaEnv.current.channel = stdChannel() */

    const task = runSaga(
      {
        ...sagaOptions,
        channel: sagaEnv.current.channel,
        dispatch,
        getState: () => {
          /* overrided by effectMiddlewares below */
          return state
        },
        effectMiddlewares: [
          runEffect => {
            return effect => {
              if (effect.type === effectTypes.SELECT) {
                return runEffect(
                  call(
                    selectAsyncSaga,
                    effect.payload.selector,
                    effect.payload.args
                  )
                )
              }
              return runEffect(effect)
            }
          },
        ],
      },
      saga
    )
    return () => task.cancel()
  }, [])

  return [state, dispatch]
}
