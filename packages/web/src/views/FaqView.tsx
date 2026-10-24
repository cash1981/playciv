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
            draws, so a draw out of turn is never an accident. When you have finished a phase,
            select <strong>End turn</strong> in Your actions so the next player can continue
            in it. Ending Research starts the next turn once every player has done it. If you
            forgot something, select <strong>Reopen</strong> to take your last ended phase
            back, make the change and end it again. Nobody else is moved while you do.
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
          title="Where do I see what my cities produce?"
          defaultOpen={false}
        >
          <p className="faq-answer">
            Your cities are in <strong>Your actions</strong>, the panel right under the board, in
            the section <strong>Your cities</strong>. Each city shows an estimate of its
            production and a link that shows how the number was counted. The estimate is not a
            complete count, because the map data does not hold every icon, and a number you type
            in by hand always wins.
          </p>
        </CollapsiblePanel>

        <CollapsiblePanel
          id="faq-build"
          title="How do I build with a city?"
          defaultOpen={false}
        >
          <p className="faq-answer">
            In your open City Management phase, press <strong>Build</strong> on your city in
            Your actions and pick what to build. A city can build a building, a wonder from the
            wonders market, an army or a scout figure, or a military unit. A building, a wonder
            or a figure is placed as soon as you tap one of the highlighted squares around the
            city, with no Confirm. A military unit is not placed. It draws a private card into your hand, so there is no square, and
            Confirm is ready at once; the log names only the type of unit. An army put on a
            square where an enemy figure stands is not automated: you settle any battle or loot by hand, and the bar says so.{' '}
            <strong>Cancel</strong> or Escape changes nothing. What is built, any trade you pay and
            the log line happen together. If you change your mind before you press{' '}
            <strong>End turn</strong>, remove the piece from the board: the build is taken back, the
            trade is returned and a new line in the log says so. After End turn, removing it is an
            ordinary removal, and so is removing a wonder after another player has taken the wonder
            that was drawn into the market after yours. The Undo vote takes a build back like your other actions. On a phone
            the squares are small at the default zoom, so zoom the board in to tap one.
          </p>
          <p className="faq-answer">
            Build opens with a button for each kind of thing the city can build now: buildings,
            wonders, figures and units, with no button for a kind that has nothing to pick. Press
            one to see its list, and <strong>Back</strong> to return to the buttons. Only what you
            can really build is listed. A wonder shows what it costs, the printed amount or less if you know the tech on its
            card, but the cost is not checked against the city&rsquo;s production: cards and Great
            Persons can add hammers, so you count that yourself. A city holds one wonder, and a second one can only go on the
            first one&rsquo;s square and takes its place. The reasons for the others are behind the link{' '}
            <strong>Why not the others</strong>. If the estimate of the city&rsquo;s production is
            too low, set the production by hand in the same card. When production is short but the
            trade covers it, the list says how much trade you pay. When you build a wonder, the next
            one is drawn into the market for you: four wonders of each era, the ancient ones
            first, then the medieval ones, then the modern ones.
          </p>
        </CollapsiblePanel>

        <CollapsiblePanel
          id="faq-replace"
          title="Can I build on top of a building or a wonder? What about City Walls?"
          defaultOpen={false}
        >
          <p className="faq-answer">
            Yes, on your own. When you pick a square for a building or a wonder, a square that holds
            one of your buildings, wonders or Great People is marked <strong>Replace</strong>, and the note
            says what goes. The old piece is taken off the board first: a building goes back to the
            supply, a wonder is destroyed and cannot be built again for the rest of the game, and a Great
            Person goes back to your player area. A wonder can replace a building and the other way round. A city holds one wonder and one limited building, so a
            second one can only take the place of the first. When the supply of a building is empty you can
            still build it on one of your own from the same supply, for example an Aqueduct on a Granary. You cannot replace
            another player&rsquo;s wonder, and a square with a city-state is taken.
            Because a replacement cannot be taken for granted, it needs <strong>Confirm</strong>, and the
            Undo vote puts the old piece back.
          </p>
          <p className="faq-answer">
            A Great Person replaces too. When you place a Great Person marker on a square in the
            outskirts of one of your cities, the building or wonder there is removed (a wonder is
            destroyed), and a Great Person already there goes back to your player area. Each is a step of
            its own in the board history, so <strong>Undo</strong> gives them back one at a time. A drop
            that would destroy a wonder asks first. A Great
            Person that has been replaced has no effect until you place it again at the start of a
            turn. A building you drag onto a Great Person by hand does not replace it: use Build.
          </p>
          <p className="faq-answer">
            <strong>City Walls</strong> need the Masonry tech and cost 7 production. They are listed
            with the buildings in Build, and a city can have only one. No square is picked: the city
            marker is turned over to its walled side. The Undo vote turns it back. The +4 for defending a
            walled city is not counted anywhere. Upgrades (a Granary to an Aqueduct) are done with the{' '}
            <strong>Upgrades</strong> block at the top of Your cities, which flips every building of the
            family at once.
          </p>
        </CollapsiblePanel>

        <CollapsiblePanel
          id="faq-city-actions"
          title="How do I start a Building Program or upgrade buildings?"
          defaultOpen={false}
        >
          <p className="faq-answer">
            In your open City Management phase, press <strong>Start Building Program</strong> on
            your city in Your actions. The marker is put on the city centre, so the next build
            in that city doubles its outskirts production. A city can have only one marker, and the
            build removes it. The button is greyed out, with the reason shown on the city card, when the phase is
            not open or the marker is already there.
          </p>
          <p className="faq-answer">
            When you have revealed the tech of an upgraded building, an <strong>Upgrades</strong>{' '}
            block at the top of Your cities lists your basic buildings that can be flipped,
            for example Granary to Aqueduct, with their squares. Press the button of one family, or{' '}
            <strong>Upgrade all</strong>. The buildings keep their squares and nothing is paid. It
            works in any phase of the game. Both actions can be taken back with the same Undo vote
            as your other actions.
          </p>
        </CollapsiblePanel>

        <CollapsiblePanel
          id="faq-gather"
          title="How do I devote a city to the arts or harvest a resource?"
          defaultOpen={false}
        >
          <p className="faq-answer">
            In your open City Management phase, press <strong>Devote to the Arts</strong> on your
            city in Your actions. The panel adds up the culture: one for the city (two for a
            metropolis), what the buildings, wonders and Great People in the outskirts give, and
            the culture icon of a natural wonder. If you have revealed Urban Development and the city
            has two different buildings or wonders in its outskirts, it adds two more, and the
            Indians get one more for each outskirts square with a resource. A scout of
            yours on another square, for example on a building in another city, can be sent to the
            city with a tick. Press <strong>Devote and take N culture</strong> and the culture is
            added to your status. The effects of your civilization, government, techs and cards are
            not counted, nor is the culture a Great Person card gives when you reveal or discard
            it, so you can type another number: the log then says the estimate was something
            else.
          </p>
          <p className="faq-answer">
            <strong>Harvest</strong> lists the resources whose icon is in the city&rsquo;s
            outskirts, or under one of your scouts. Press <strong>Take</strong> next to one and the
            token is put in your player area, ready to pay for a card. A resource the market has
            run out of is greyed out. An enemy figure on a square blockades it, and a building, wonder, Great Person or disaster token on a square covers its resource, so it cannot be harvested. A disaster token also covers the square's culture icon. The game does not
            keep track of which scout has been sent where, and the rules say one resource icon may
            be harvested only once a turn, so you watch that yourself. A city takes one action each
            turn: Build, Start Building Program, Devote to the Arts or Harvest. If the city has
            already acted, the game asks whether you are sure, and you can say yes. The map
            icons were read by eye from the tile images and may be wrong; if so, place the token or
            change the culture by hand as before. Both can be taken back with the same Undo vote as
            your other actions, as long as the culture is not spent and the token is still in your
            area.
          </p>
        </CollapsiblePanel>
      </div>
    </main>
  )
}
