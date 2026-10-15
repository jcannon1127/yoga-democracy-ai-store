import Image from "next/image"
import { Heading, Text } from "@medusajs/ui"
import YotpoLoyalty from "@modules/content/components/yotpo-loyalty"

/**
 * Renders a content page from extracted blocks.
 *
 * Page copy is data (`src/content/pages/*.json`), not components — per the tenancy rules,
 * content and business copy live in data rather than in code. Adding the next content page
 * is an extraction, not a build.
 */
export type Block =
  | { type: "heading"; text: string; level?: number }
  | { type: "text"; text: string }
  | { type: "list-item"; text: string }
  | { type: "image"; src: string }
  | { type: "banner"; src: string }
  | { type: "video"; youtube_id?: string | null; src: string }
  | { type: "table"; rows: string[][] }
  | { type: "widget"; provider: string; instance_id: string }

const Banner = ({ src, caption }: { src: string; caption?: string }) => (
  <div className="relative w-full h-[280px] small:h-[420px] my-10 overflow-hidden">
    <Image
      src={src}
      alt={caption ?? ""}
      fill
      sizes="100vw"
      className="object-cover"
      priority={false}
    />
    {caption && (
      <div className="absolute inset-0 flex items-end justify-center pb-10 bg-gradient-to-t from-black/50 to-transparent">
        <Heading level="h2" className="text-white text-3xl small:text-5xl font-normal">
          {caption}
        </Heading>
      </div>
    )}
  </div>
)

export default function PageBlocks({ blocks }: { blocks: Block[] }) {
  const out: React.ReactNode[] = []

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    const next = blocks[i + 1]

    switch (b.type) {
      case "banner": {
        // On the live site the section heading sits *inside* the banner, in white over the
        // image. Pair them back up so the page keeps that shape.
        if (next?.type === "heading") {
          out.push(<Banner key={i} src={b.src} caption={next.text} />)
          i++
        } else {
          out.push(<Banner key={i} src={b.src} />)
        }
        break
      }
      case "heading":
        out.push(
          <Heading
            key={i}
            level={(b.level === 1 ? "h1" : "h2") as "h1" | "h2"}
            className="text-2xl small:text-3xl text-ui-fg-base font-normal mt-10 mb-4"
          >
            {b.text}
          </Heading>
        )
        break
      case "text":
        out.push(
          <Text key={i} className="text-ui-fg-subtle leading-7 mb-4 max-w-3xl">
            {b.text}
          </Text>
        )
        break
      case "list-item":
        out.push(
          <li key={i} className="text-ui-fg-subtle leading-7 ml-6 list-disc">
            {b.text}
          </li>
        )
        break
      case "image":
        out.push(
          <div key={i} className="my-8">
            <Image
              src={b.src}
              alt=""
              width={1200}
              height={800}
              sizes="(max-width: 768px) 100vw, 900px"
              className="w-full h-auto"
            />
          </div>
        )
        break
      case "table":
        out.push(
          // Size charts are wide. Scroll the table inside its own box rather than letting
          // the page scroll sideways on a phone.
          <div key={i} className="my-6 overflow-x-auto max-w-full">
            <table className="min-w-full text-left border-collapse">
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r} className="border-b border-ui-border-base">
                    {row.map((cell, c) => (
                      <td
                        key={c}
                        className={
                          "px-3 py-2 whitespace-nowrap txt-small " +
                          (r === 0
                            ? "font-medium text-ui-fg-base"
                            : "text-ui-fg-subtle")
                        }
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
        break
      case "widget":
        if (b.provider === "yotpo-loyalty") {
          out.push(<YotpoLoyalty key={i} instanceId={b.instance_id} />)
        }
        break
      case "video":
        out.push(
          <div key={i} className="my-10 relative w-full aspect-video max-w-4xl">
            <iframe
              src={`https://www.youtube.com/embed/${b.youtube_id}`}
              title="Yoga Democracy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 w-full h-full"
            />
          </div>
        )
        break
    }
  }

  return <>{out}</>
}
