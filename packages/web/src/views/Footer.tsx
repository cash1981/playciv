/**
 * Site-wide footer. Ported from old-civ-web/app/index.html, where
 * `<footer class="footer">` sat outside the routed AngularJS view, so it
 * showed on every page. This is issue #77.
 *
 * The PayPal form is the old encrypted hosted button, copied verbatim: it is
 * what makes this the same donation to the same account. The Patreon link the
 * old footer also had is dropped on purpose — see docs/agents/decisions.md.
 *
 * Beside it sits a Buy Me a Coffee button, added later at the human's request
 * from the exact markup they supplied (there was no Buy Me a Coffee in the old
 * footer). Like Patreon, it is a plain image link, not their JavaScript widget.
 */

// The Buy Me a Coffee button the human supplied, kept verbatim.
const BUYMEACOFFEE_URL = 'https://www.buymeacoffee.com/cash1981'
const BUYMEACOFFEE_IMAGE =
  'https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=&slug=cash1981&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff'

// The encrypted hosted-button value from old-civ-web/app/index.html.
const PAYPAL_ENCRYPTED_BUTTON =
  '-----BEGIN PKCS7-----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-----END PKCS7-----'

export function Footer(): React.JSX.Element {
  return (
    <footer className="site-footer">
      <p className="site-footer-legal">
        Copyright &copy; 2015&ndash;2026 by Shervin Asgari. All rights reserved.
        Licensed under{' '}
        <a
          href="https://www.apache.org/licenses/LICENSE-2.0"
          target="_blank"
          rel="noopener noreferrer"
        >
          Apache 2.0 License
        </a>
        .
      </p>
      <div className="site-footer-support">
        <form
          className="site-footer-donate"
          action="https://www.paypal.com/cgi-bin/webscr"
          method="post"
          target="_top"
        >
          <input type="hidden" name="cmd" value="_s-xclick" />
          <input type="hidden" name="encrypted" value={PAYPAL_ENCRYPTED_BUTTON} />
          <input
            type="image"
            src="https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif"
            name="submit"
            alt="Donate with PayPal"
          />
          {/* The old form's 1x1 tracking image, kept alongside it. */}
          <img
            src="https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif"
            alt=""
            width={1}
            height={1}
          />
        </form>
        <a
          className="site-footer-coffee"
          href={BUYMEACOFFEE_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <img src={BUYMEACOFFEE_IMAGE} alt="Buy me a coffee" />
        </a>
      </div>
    </footer>
  )
}
