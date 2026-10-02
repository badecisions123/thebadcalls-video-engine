import { cancelRender, continueRender, delayRender } from "remotion";
import montserrat900 from "@fontsource/montserrat/files/montserrat-latin-900-normal.woff2";

export const CAPTION_FONT = "Montserrat";

// Bundled with the project so captions look the same on every machine.
// Rendering waits until the font is ready so no frame is drawn with a fallback.
const handle = delayRender("Loading caption font");
const face = new FontFace(CAPTION_FONT, `url(${montserrat900}) format("woff2")`, { weight: "900" });
face
  .load()
  .then(() => {
    document.fonts.add(face);
    continueRender(handle);
  })
  .catch((err) => cancelRender(err));
