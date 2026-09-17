import { CollapsiblePanel } from './CollapsiblePanel.js'

/** Public answers for the common questions from the original client FAQ. */
export function FaqView(): React.JSX.Element {
  return (
    <main className="faq-page">
      <h1>Frequently asked questions</h1>
      <p className="muted faq-intro">
        A quick guide to creating games, taking turns and using the virtual board.
      </p>

      <div className="panel-stack faq-list">
        <CollapsiblePanel id="faq-account-game" title="How do I create an account and a game?">
          <p className="faq-answer">
            Create an account and sign in. On the games page, enter a name, choose two to five
            players and select <strong>Create</strong>.
          </p>
        </CollapsiblePanel>

        <CollapsiblePanel id="faq-join-game" title="How do I join a game?" defaultOpen={false}>
          <p className="faq-answer">
            Sign in, find the active game in the list and select <strong>Join</strong>. The game
            opens automatically after you join.
          </p>
        </CollapsiblePanel>

        <CollapsiblePanel
          id="faq-first-draw"
          title="I created a game. Why can&apos;t I draw any items?"
          defaultOpen={false}
        >
          <p className="faq-answer">
            Every player must join before the game can begin drawing. After everyone has joined,
            you can draw items only during your own turn.
          </p>
        </CollapsiblePanel>

        <CollapsiblePanel
          id="faq-turn-draw"
          title="All players joined, but I cannot draw items, only choose tech?"
          defaultOpen={false}
        >
          <p className="faq-answer">
            Check the turn indicator at the top of the game. Draw controls are enabled only for
            the player whose turn it is. When you have finished, select <strong>End turn</strong>
            so the next player can continue.
          </p>
        </CollapsiblePanel>

        <CollapsiblePanel id="faq-board" title="How do I add a new map?" defaultOpen={false}>
          <p className="faq-answer">
            The board is at the top of the game page. Choose a category in the <strong>Pieces</strong>{' '}
            palette, then drag a piece onto the map or into a player area. Dropping in a player
            area tidies pieces into the next available slot; dropping on the map keeps the exact
            position. Everyone in the game can see and move the pieces.
          </p>
          <p className="faq-answer">
            Use <strong>Zoom</strong> to change the board size. Select a piece to rotate it, move
            it to the front or back, or remove it. The board history lets you undo changes and
            replay earlier positions; the board is read-only while replaying.
          </p>
        </CollapsiblePanel>

        <CollapsiblePanel
          id="faq-map-assets"
          title="How do I add a new asset?"
          defaultOpen={false}
        >
          <p className="faq-answer">
            Open the game board and choose <strong>Map tiles</strong> or another category from the
            palette. Drag the asset onto the board, then select it to rotate or reposition it.
            Exploration tiles are placed in the first free map slot as a convenience, and starting
            tiles are placed automatically when a civilization is revealed.
          </p>
          <p className="faq-answer">
            You do not need a Google account, a spreadsheet or an external map link. The current
            board and its assets are part of the game page.
          </p>
        </CollapsiblePanel>
      </div>
    </main>
  )
}
