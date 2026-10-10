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
            The board sits near the top of the game page, with the <strong>Pieces</strong> palette
            just below it. Choose a category in the palette, then drag a piece onto the map or into
            a player area, or tap the piece and then tap the map. Dropping in a player
            area tidies pieces into the next available slot; dropping on the map keeps the exact
            position. Everyone in the game can see and move the pieces.
          </p>
          <p className="faq-answer">
            Use <strong>Zoom</strong> to change the board size. Select a piece to rotate it, move
            it to the front or back, or remove it. <strong>Undo</strong> takes back your own last
            change — it is disabled once someone else has acted since — and <strong>Redo</strong>{' '}
            brings it straight back, until any further change clears it. The board history also
            lets you replay earlier positions; the board is read-only while replaying.
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

        <CollapsiblePanel
          id="faq-cities"
          title="What does the Cities panel show?"
          defaultOpen={false}
        >
          <p className="faq-answer">
            The Cities panel estimates how much production each city on the map has, and
            shows how the number was counted. The estimate is not a complete count, because the
            map data does not hold every icon, and a number you type in by hand always wins.
          </p>
        </CollapsiblePanel>

        <CollapsiblePanel
          id="faq-build"
          title="How do I build a building?"
          defaultOpen={false}
        >
          <p className="faq-answer">
            In your open City Management phase, press <strong>Build</strong> on your city in the
            Cities panel and pick a building. Then tap one of the highlighted squares on the board
            and press <strong>Confirm</strong>. <strong>Cancel</strong> or Escape changes nothing.
            The building, any trade you pay and the log line happen together, and a vote can undo
            them like your other actions. On a phone the squares are small at the default zoom, so
            zoom the board in to tap one.
          </p>
          <p className="faq-answer">
            Only buildings you can really build are listed. The reasons for the others are under{' '}
            <strong>Why not the others</strong>. If the estimate of the city&rsquo;s production is
            too low, set the production by hand in the same card. When production is short but the
            trade covers it, the list says how much trade you pay.
          </p>
        </CollapsiblePanel>
      </div>
    </main>
  )
}
