import Image from "next/image";

const PHOTOGRAPHY: Record<string, { alt: string; caption: string }> = {
  agencies: {
    alt: "Designer reviewing creative work on a studio monitor",
    caption:
      "Creative work needs room to happen. Give its administration a home.",
  },
  consulting: {
    alt: "Colleagues reviewing work together at a laptop",
    caption:
      "Keep the engagement organized, from the first conversation onward.",
  },
  technology: {
    alt: "Developer concentrating on code at a workstation",
    caption:
      "A shared operational foundation for delivery and customer support.",
  },
  construction: {
    alt: "Structural frame of a building under construction beside a tower crane",
    caption:
      "Organize the administration around the project, wherever work happens.",
  },
};

export function IndustryPhotography({ industry }: { industry: string }) {
  const photo = PHOTOGRAPHY[industry];
  if (!photo) return null;
  return (
    <figure className={`nm-industry-photo nm-industry-photo-${industry}`}>
      <div className="nm-industry-photo-frame">
        <Image
          src={`/images/industries/${industry}.webp`}
          alt={photo.alt}
          fill
          sizes="(max-width: 800px) 100vw, 55vw"
        />
      </div>
      <figcaption>{photo.caption}</figcaption>
    </figure>
  );
}
