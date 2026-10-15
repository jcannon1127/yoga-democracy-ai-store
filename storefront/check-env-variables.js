const c = require("ansi-colors")

const requiredEnvs = [
  {
    key: "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY",
    // TODO: we need a good doc to point this to
    description:
      "Learn how to create a publishable key: https://docs.medusajs.com/v2/resources/storefront-development/publishable-api-keys",
  },
]

function checkEnvVariables() {
  const missingEnvs = requiredEnvs.filter(function (env) {
    return !process.env[env.key]
  })

  if (missingEnvs.length > 0) {
    console.error(
      c.red.bold("\n🚫 Error: Missing required environment variables\n")
    )

    missingEnvs.forEach(function (env) {
      console.error(c.yellow(`  ${c.bold(env.key)}`))
      if (env.description) {
        console.error(c.dim(`    ${env.description}\n`))
      }
    })

    console.error(
      c.yellow(
        "\nPlease set these variables in your .env file or environment before starting the application.\n"
      )
    )

    process.exit(1)
  }

  checkUrlShapeAgreement()
}

/**
 * The URL shape is decided in two places — the middleware serves it, the app emits it — and
 * they MUST agree. Serving bare paths while emitting `/us/` canonicals, or the reverse, is a
 * site advertising addresses it does not serve, which is the single most expensive thing this
 * migration can get wrong and produces no error at all.
 *
 * Both now default to bare in code, so the only way to disagree is to set one and forget the
 * other while putting the prefix back. That is exactly the moment a build should stop.
 */
function checkUrlShapeAgreement() {
  const served = process.env.YD_SERVE_BARE_PATHS !== "0"
  const emitted = process.env.NEXT_PUBLIC_DEFAULT_REGION_BARE_PATH !== "false"

  if (served !== emitted) {
    console.error(
      c.red.bold("\n🚫 Error: the URL shape disagrees with itself\n")
    )
    console.error(
      c.yellow(
        `  middleware SERVES ${served ? "bare paths (/shop/tops)" : "prefixed paths (/us/shop/tops)"}\n` +
        `  the app EMITS   ${emitted ? "bare paths" : "prefixed paths"} in canonicals, the sitemap and every link\n`
      )
    )
    console.error(
      c.dim(
        "    Set YD_SERVE_BARE_PATHS and NEXT_PUBLIC_DEFAULT_REGION_BARE_PATH together,\n" +
        "    or unset both to get the current decision: no /us/ prefix.\n"
      )
    )
    process.exit(1)
  }
}

module.exports = checkEnvVariables
