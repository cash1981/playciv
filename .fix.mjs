import { readFileSync, writeFileSync } from 'node:fs'

const CR = String.fromCharCode(13)

/** @param {string} path @param {[string,string][]} edits */
function patch(path, edits) {
  let text = readFileSync(path, 'utf8').split(CR).join('')
  for (const [from, to] of edits) {
    if (!text.includes(from)) {
      console.error(`MISS ${path}\n     ${JSON.stringify(from.slice(0, 70))}`)
      process.exitCode = 1
      continue
    }
    text = text.split(from).join(to)
  }
  writeFileSync(path, text, 'utf8')
  console.log(`patched ${path}`)
}

patch('packages/web/src/views/ItemCard.tsx', [
  // An unloaded image has no intrinsic size, so inside a flex box it lays out
  // at 0 x 0 and `loading="lazy"` never decides it is on screen. The CSS gives
  // it a box; loading eagerly keeps it out of that loop altogether.
  [`          <img
            src={url}
            alt={label}
            loading="lazy"
            onError={(event) => {`,
   `          <img
            src={url}
            alt={label}
            onError={(event) => {`],
])

patch('packages/web/src/styles.css', [
  [`.card-art img {
  max-width: 100%;
  max-height: 13rem;
  object-fit: contain;
}

.card-grid.small .card-art img {
  max-height: 7rem;
}`,
   `/* A width is needed before the file loads, or the image lays out at zero */
.card-art img {
  width: 100%;
  height: auto;
  max-height: 13rem;
  object-fit: contain;
}

.card-grid.small .card-art img {
  max-height: 7rem;
}`],
])
