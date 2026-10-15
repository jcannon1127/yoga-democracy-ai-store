"use client"

import { useState } from "react"
import { Heading } from "@medusajs/ui"

import Modal from "@modules/common/components/modal"
import PageBlocks, { Block } from "@modules/content/components/page-blocks"

/**
 * Size chart, in a modal, opened from beside the size dropdown.
 *
 * yd-features asked for a modal rather than a link out, and the reason is worth keeping
 * next to the code: **YD has no returns portal.** Every return is a customer emailing
 * cs@yogademocracy.com and a person handling it by hand. A size chart at the moment of
 * choosing a size is the cheapest return prevention on the site, and sending someone to
 * another page to find it loses most of the benefit.
 *
 * The chart itself is not duplicated here — it renders the same `src/content/pages/
 * size-chart.json` blocks the /pages/size-chart route uses, so there is exactly one chart
 * and updating it updates both.
 */
const SizeChartModal = ({ blocks }: { blocks: Block[] }) => {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-x-2 text-ui-fg-base hover:text-ui-fg-subtle"
        data-testid="size-chart-link"
      >
        {/* Ruler, matching the live page's icon-size-chart glyph. */}
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <rect x="2" y="7" width="20" height="10" rx="1" />
          <path d="M6 7v3M10 7v5M14 7v3M18 7v5" />
        </svg>
        <span className="underline txt-medium">Size Chart</span>
      </button>

      <Modal isOpen={open} close={() => setOpen(false)} size="large" data-testid="size-chart-modal">
        <Modal.Title>
          <Heading level="h2" className="text-xl font-normal">
            Size Chart
          </Heading>
        </Modal.Title>
        <Modal.Body>
          <div className="overflow-y-auto">
            <PageBlocks blocks={blocks} />
          </div>
        </Modal.Body>
      </Modal>
    </>
  )
}

export default SizeChartModal
