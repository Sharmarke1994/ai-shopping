import sharp from "sharp";

// Original schematic bedroom illustrations for upload/visual QA, not user photos
// and not model-generated room evidence. Only their rasterised PNG bytes upload.
export async function spaceFixturePhotos() {
  return Promise.all(
    ["Room overview", "Desk and window", "Bed and shelving"].map(
      async (title, index) => ({
        name: `fictional-bedroom-${index + 1}.png`,
        mimeType: "image/png",
        buffer: await sharp(
          Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
      <rect width="960" height="640" fill="${["#ddd3bf", "#dfd9cb", "#d9cbb5"][index]}"/>
      <path d="M0 420L480 330L960 420V640H0Z" fill="#a4977e"/><path d="M480 0V330" stroke="#c4b9a4" stroke-width="3"/>
      <rect x="80" y="82" width="245" height="238" rx="2" fill="#f7f5e9"/><rect x="95" y="97" width="215" height="208" fill="#b9cace"/><path d="M202 98V306M95 200H310" stroke="#f7f5e9" stroke-width="8"/>
      <path d="M70 360L340 320L440 440L160 500Z" fill="#d0b995"/><path d="M70 360L160 500V570L70 425Z" fill="#947b59"/><path d="M160 500L440 440V510L160 570Z" fill="#b3a08a"/><path d="M105 357L329 325L358 362L135 402Z" fill="#f1eadb"/>
      <path d="M535 355L820 398L817 418L533 375Z" fill="#343b34"/><path d="M550 373V505M800 416V535" stroke="#2f3730" stroke-width="12"/>
      <path d="M631 252L735 270V351L631 334Z" fill="#333d3a"/><path d="M642 266L722 280V334L642 321Z" fill="#778b83"/><path d="M679 344V375" stroke="#343b34" stroke-width="9"/>
      <path d="M839 180L920 197V397L839 380Z" fill="#695842"/><path d="M847 231L912 244M847 285L912 298M847 340L912 353" stroke="#c8b79a" stroke-width="8"/>
      <rect x="30" y="24" width="330" height="34" rx="3" fill="#f7f5e9" opacity=".95"/><text x="43" y="47" font-family="sans-serif" font-size="16" fill="#343b34">Fictional test view ${index + 1} · ${title}</text>
      <text x="34" y="610" font-family="sans-serif" font-size="13" fill="#f7f5e9">CONSIDER · Upload fixture, not a photograph or visual analysis</text>
    </svg>`),
        )
          .png()
          .toBuffer(),
      }),
    ),
  );
}
