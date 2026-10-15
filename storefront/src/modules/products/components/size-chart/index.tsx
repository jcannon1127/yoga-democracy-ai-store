import fs from "fs"
import path from "path"

import { Block } from "@modules/content/components/page-blocks"
import SizeChartModal from "./size-chart-modal"

const FILE = path.join(process.cwd(), "src/content/pages/size-chart.json")

/**
 * Reads the one canonical size chart off disk and hands it to the modal.
 *
 * Server component on purpose: the chart is a few hundred lines of table and there is no
 * reason to ship it to the browser as part of the product bundle on every PDP. If the file
 * is ever missing the link simply does not render — a product page must not 500 because a
 * content file moved.
 */
const SizeChart = () => {
  let blocks: Block[] = []

  try {
    blocks = JSON.parse(fs.readFileSync(FILE, "utf-8")).blocks ?? []
  } catch {
    return null
  }

  if (!blocks.length) return null

  return <SizeChartModal blocks={blocks} />
}

export default SizeChart
