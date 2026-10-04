import './AutoRefresh.css'

interface SwitchProps {
  readonly on: boolean
  readonly seconds: number
  readonly onToggle: () => void
}

/**
 * The game header's auto-refresh switch. A filled green dot and "on" when the
 * game is being watched for changes, a hollow dashed one and "off" when it is
 * not, so the state reads without knowing which colour means what.
 */
export function AutoRefreshSwitch({ on, seconds, onToggle }: SwitchProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={'small auto-refresh-switch' + (on ? ' on' : ' off')}
      onClick={onToggle}
      title={
        on
          ? `Checking for changes every ${seconds} seconds. Turn off.`
          : 'Not checking for changes. Turn on.'
      }
    >
      <span className="auto-refresh-dot" aria-hidden="true" />
      {on ? 'Auto-refresh on' : 'Auto-refresh off'}
    </button>
  )
}

/**
 * The same state as a line of text, for the chat panel, where the player is
 * writing and wants to know whether the other side's messages will arrive by
 * themselves.
 */
export function AutoRefreshStatus({ on }: { readonly on: boolean }): React.JSX.Element {
  return (
    <span
      className={'auto-refresh-status' + (on ? ' on' : ' off')}
      title={on ? 'New messages show up by themselves' : 'New messages will not show up by themselves'}
    >
      <span className="auto-refresh-dot" aria-hidden="true" />
      {on ? 'Auto-refresh on' : 'Auto-refresh off'}
    </span>
  )
}
