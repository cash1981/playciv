export function AboutView(): React.JSX.Element {
  return (
    <main className="about-page">
      <h1>About Civilization</h1>

      <section className="panel" aria-labelledby="about-legal-heading">
        <h2 id="about-legal-heading">About this project</h2>
        <p>
          This software is licensed under the{' '}
          <a
            href="https://www.apache.org/licenses/LICENSE-2.0"
            target="_blank"
            rel="noopener noreferrer"
          >
            Apache 2.0 License
          </a>
          .
        </p>
        <p>
          I do not own the trademark of Civilization the board game. That is a
          trademark of Fantasy Flight Games.
        </p>
        <p>
          I am not affiliated with Fantasy Flight Games in any sort. I am just
          a fan that wanted to enable playing this game online!
        </p>
        <p>To play this game, it is required that you own a copy of the board game!</p>
      </section>

      <section className="panel" aria-labelledby="about-code-heading">
        <h2 id="about-code-heading">Source code</h2>
        <p>
          The code for this project is available in the{' '}
          <a href="https://github.com/cash1981/playciv" target="_blank" rel="noopener noreferrer">
            playciv GitHub repository
          </a>
          . You can browse the{' '}
          <a
            href="https://github.com/cash1981/playciv/tree/main/packages/web"
            target="_blank"
            rel="noopener noreferrer"
          >
            frontend
          </a>
          ,{' '}
          <a
            href="https://github.com/cash1981/playciv/tree/main/packages/server"
            target="_blank"
            rel="noopener noreferrer"
          >
            backend
          </a>
          , and{' '}
          <a
            href="https://github.com/cash1981/playciv/tree/main/packages/engine"
            target="_blank"
            rel="noopener noreferrer"
          >
            game engine
          </a>{' '}
          there.
        </p>
      </section>

      <section className="panel" aria-labelledby="about-contact-heading">
        <h2 id="about-contact-heading">Contact</h2>
        <p>
          You can contact me at <b>cash '@' playciv.com</b>
        </p>
      </section>
    </main>
  )
}
