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
            you can draw at any time. On your own turn the draw happens at once; out of turn the
            game asks you first.
          </p>
        </CollapsiblePanel>

        <CollapsiblePanel
          id="faq-turn-draw"
          title="All players joined, but I cannot draw items, only choose tech?"
          defaultOpen={false}
        >
          <p className="faq-answer">
            Check the turn indicator at the top of the game. The Draw buttons work for every
            player. When it is not your turn, the game asks &ldquo;Draw anyway?&rdquo; before it
            draws, so a draw out of turn is never an accident. When you have finished your own
            turn, select <strong>End turn</strong> so the next player can continue.
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
          title="How do I build with a city?"
          defaultOpen={false}
        >
          <p className="faq-answer">
            In your open City Management phase, press <strong>Build</strong> on your city in the
            Cities panel and pick what to build. A city can build a building, an army or a scout
            figure, or a military unit. A building and a figure are placed on the map: tap one of
            the highlighted squares around the city and press <strong>Confirm</strong>. A military
            unit is not placed. It draws a private card into your hand, so there is no square, and
            Confirm is ready at once; the log names only the type of unit. An army put on a
            square where an enemy figure stands is not automated: you settle any battle or loot by hand, and the bar says so.{' '}
            <strong>Cancel</strong> or Escape changes nothing. What is built, any trade you pay and
            the log line happen together, and the same Undo vote takes them back like your other
            actions. On a phone the squares are small at the default zoom, so zoom the board in to
            tap one.
          </p>
          <p className="faq-answer">
            Only what you can really build is listed, in three groups: buildings, figures and
            units. The reasons for the others are under{' '}
            <strong>Why not the others</strong>. If the estimate of the city&rsquo;s production is
            too low, set the production by hand in the same card. When production is short but the
            trade covers it, the list says how much trade you pay.
          </p>
        </CollapsiblePanel>

        <CollapsiblePanel
          id="faq-city-actions"
          title="How do I start a Building Program or upgrade buildings?"
          defaultOpen={false}
        >
          <p className="faq-answer">
            In your open City Management phase, press <strong>Start Building Program</strong> on
            your city in the Cities panel. The marker is put on the city centre, so the next build
            in that city doubles its outskirts production. A city can have only one marker, and the
            build removes it. The button is greyed out, with the reason shown on the city card, when the phase is
            not open or the marker is already there.
          </p>
          <p className="faq-answer">
            When you have revealed the tech of an upgraded building, an <strong>Upgrades</strong>{' '}
            block at the top of the Cities panel lists your basic buildings that can be flipped,
            for example Granary to Aqueduct, with their squares. Press the button of one family, or{' '}
            <strong>Upgrade all</strong>. The buildings keep their squares and nothing is paid. It
            works in any phase of the game. Both actions can be taken back with the same Undo vote
            as your other actions.
          </p>
        </CollapsiblePanel>
      </div>
    </main>
  )
}
