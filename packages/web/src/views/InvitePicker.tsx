/**
 * Picks the players to invite to a private game (issue #348): type a few letters, choose a suggestion from the
 * list, and each chosen name becomes a chip that can be removed. Only existing usernames can be chosen.
 */

import { useEffect, useId, useState } from 'react'

import { api } from '../lib/api.js'

interface Props {
  readonly selected: readonly string[]
  readonly onChange: (next: readonly string[]) => void
  /** How many must be invited: one less than the seats. */
  readonly max: number
}

const DEBOUNCE_MS = 200

export function InvitePicker({ selected, onChange, max }: Props): React.JSX.Element {
  const listId = useId()
  const [text, setText] = useState('')
  const [suggestions, setSuggestions] = useState<readonly string[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  useEffect(() => {
    const query = text.trim()
    if (query === '') {
      setSuggestions([])
      return
    }
    let stale = false
    const timer = setTimeout(() => {
      api
        .searchPlayers(query)
        .then((found) => {
          if (stale) return
          const chosen = new Set(selected.map((name) => name.toLowerCase()))
          setSuggestions(found.map((entry) => entry.username).filter((name) => !chosen.has(name.toLowerCase())))
          setActive(0)
        })
        .catch(() => {
          if (!stale) setSuggestions([])
        })
    }, DEBOUNCE_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [text, selected])

  const full = selected.length >= max

  const choose = (username: string): void => {
    if (full || selected.some((name) => name.toLowerCase() === username.toLowerCase())) return
    onChange([...selected, username])
    setText('')
    setSuggestions([])
  }

  const showList = open && !full && suggestions.length > 0

  return (
    <div className="invite-picker">
      {selected.map((name) => (
        <span key={name} className="invite-chip">
          {name}
          <button
            type="button"
            aria-label={`Remove ${name}`}
            onClick={() => onChange(selected.filter((entry) => entry !== name))}
          >
            ×
          </button>
        </span>
      ))}
      <div className="invite-input">
        <input
          role="combobox"
          aria-label="Invite player"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          value={text}
          disabled={full}
          placeholder={
            full ? `All ${max} invited` : `Search for a player (${selected.length} of ${max} invited)`
          }
          onChange={(event) => {
            setText(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && showList) {
              event.preventDefault()
              setActive((index) => (index + 1) % suggestions.length)
            } else if (event.key === 'ArrowUp' && showList) {
              event.preventDefault()
              setActive((index) => (index - 1 + suggestions.length) % suggestions.length)
            } else if (event.key === 'Enter' && showList) {
              // Choosing a name must not submit the new-game form.
              event.preventDefault()
              const pick = suggestions[active]
              if (pick !== undefined) choose(pick)
            } else if (event.key === 'Escape') {
              setOpen(false)
            }
          }}
        />
        {showList && (
          <ul id={listId} role="listbox" className="invite-suggestions">
            {suggestions.map((name, index) => (
              <li
                key={name}
                role="option"
                aria-selected={index === active}
                className={index === active ? 'active' : undefined}
                // mousedown, not click: the input's blur would close the list before a click lands.
                onMouseDown={(event) => {
                  event.preventDefault()
                  choose(name)
                }}
              >
                {name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
