import { formatTimestamp } from '../lib/formatTimestamp.js'

interface Props {
  readonly createdAt: string
}

export function ChatTimestamp({ createdAt }: Props): React.JSX.Element | null {
  const timestamp = formatTimestamp(createdAt)
  if (timestamp === '') return null

  return (
    <time className="log-time" dateTime={createdAt}>
      {timestamp}
    </time>
  )
}
