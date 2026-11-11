# Seeing like a brain

A vision-science lab for paintings. You look at six famous works through four lenses that imitate parts of the visual system: the fovea, the lightness-only pathway, viewing distance, and the way eyes move. Each painting comes with a short essay that uses the lens to test a claim art historians and scientists have made about it.

**Live version: https://radhikw.github.io/cs85hw4/** (live once GitHub Pages is switched on for this repo)

Course: art history software artifact. Everything runs in the browser. There is no server and no build step.

## What to try first

1. Open the site on a laptop. Move the cursor over *Impression, Sunrise*. Only the patch under it is sharp, like your fovea. The rest is blurred by an acuity model, not by an arbitrary filter.
2. Click **Luminance**, then **Measure the sun against the sky**. The two probes report the lightness (L*) of the sun and the haze beside it. They differ by about 2 points out of 100, and the colors differ a lot.
3. Click **Mark the isoluminance edges**. The cyan marks are edges where the color changes but the lightness barely does.
4. Open **Distance**, pick *A Sunday on La Grande Jatte* and press **Step back**. The page tells you how far away you would have to stand for your eye to blur Seurat's dots by that much.
5. Open **Scanpath**, pick *They Did Not Expect Him*, and look at it for 30 seconds under two different tasks. Compare the dwell maps.

Phones work too: drag a finger to move the fovea.

## Why this project

The question behind it is one I could not shake after the museum visit: when a painting "shimmers," or a smile "comes and goes," is that a fact about the paint or a fact about the viewer? Art history mostly answers with the paint and the period. Vision science answers with the viewer. I wanted a tool that lets you hold both, and lets you check a claim instead of just reading it.

Three claims anchor the lenses.

**Impressionism and the color-blind pathway.** Margaret Livingstone, a Harvard neurobiologist, argues that the visual system splits the work. One pathway is sensitive to color and supports recognition. Another is nearly color-blind, cares about lightness, and supports locating things, motion and depth. When two regions differ only in color (isoluminance), the second pathway cannot place the boundary, and the shape can seem to float or flicker. She points to the sun in Monet's *Impression, Sunrise* (1872), which is orange against grey-blue haze at nearly the same lightness. The critic Louis Leroy mocked the picture in 1874 and its title gave the Impressionists their name. The Luminance lens lets you measure that claim in the reproduction in front of you.

**The Mona Lisa's smile and spatial frequency.** Livingstone also argues that the smile lives in the coarse patterns of light and dark (low spatial frequencies). Peripheral vision carries those well, so the smile is stronger when you look at her eyes and weaker when you look straight at the mouth. Leonardo's *sfumato*, the dissolved contour, is the technique that puts the expression there. The Distance and Fovea lenses blur the face so you can watch the mouth.

**Seurat's optical mixing and Yarbus's seven questions.** Seurat built *A Sunday on La Grande Jatte* (1884 to 1886) from separate touches of color, working from Chevreul's contrast theory (1839) and Ogden Rood's *Modern Chromatics* (1879), betting the dots would blend in the eye. The Distance lens does the arithmetic. For a crop about 74 cm wide, a 3-pixel blur (about 2 mm on the canvas) corresponds to standing roughly 25 meters away, far outside any gallery. Up close the dots stay separate. And in 1967 Alfred Yarbus reported that one viewer looked at Repin's *They Did Not Expect Him* very differently under seven different instructions. That result is contested (Greene, Liu and Wolfe 2012 failed to predict the task from eye movements, and Borji and Itti 2014 defended it), and the Scanpath lens lets you run a small version of the experiment on yourself.

The project is also deliberately skeptical of itself. John Hyman, a philosopher of art, argues that brain science can explain how we see a picture but not what makes it good or what it meant to its first viewers. John Onians, an art historian, argues the opposite, that art history needs the brain. The lenses show mechanisms. They do not settle that argument, and each essay says where its claim stops.

## How it works

Everything is plain JavaScript modules. WebGL2 draws the painting. A 2D canvas on top draws overlays.

### Fovea lens

The blur at each pixel comes from the contrast-sensitivity model of Geisler and Perry (1998), used in foveated video compression. A grating of spatial frequency *f* at eccentricity *e* degrees is visible if its contrast is above

`CT(f, e) = CT0 · exp(α · f · (e + e2) / e2)` with α = 0.106, e2 = 2.3 degrees, CT0 = 1/64.

Setting CT to 1 gives the highest visible frequency at each eccentricity: about 39 cycles per degree at the fixation point and 7.3 at 10 degrees. I turn that cutoff into a Gaussian blur width, `σ(e) = σ0 · (1 + k · e / e2)`, where σ0 comes from the foveal cutoff. The slider labeled "Falloff" is *k*, so ×1 is the lab estimate and higher values exaggerate the peripheral loss. It never blurs the fovea itself. The fragment shader keeps a pyramid of seven pre-blurred copies (σ from 0 to 48 pixels) and blends between the two nearest levels per pixel, so the blur varies smoothly with distance from the cursor. "Field of view" sets how many degrees the painting spans, which fixes pixels per degree. An optional color-fade is an illustration, not a calibrated model. Crowding, which limits peripheral vision more than blur does, is not modeled.

### Luminance lens

Pixels are converted from sRGB to CIELAB (D65). L* is lightness. The pair (a*, b*) is color. The lens can show the painting as lightness only (a gray image with the same L*), or as color only (a*, b* at constant L*), with a draggable divider so you can compare against the original.

For the isoluminance overlay, each pixel gets two edge strengths from Gaussian-smoothed gradients (σ = 1.2 px): *gL*, the gradient of L*, and *gC*, the gradient magnitude of (a*, b*). A pixel is marked when `gC ≥ threshold` and `gC ≥ 3 · gL`. The page also reports the **share** of strong color-edge pixels that are marked. The probe tool averages Lab inside a small disc at two clicks and tells you the lightness difference, the chroma difference and a plain-language verdict ("isoluminant: color differs, lightness does not" when the lightness gap is 6 or less and the chroma gap is 15 or more).

### Distance lens

Blur the painting by a Gaussian of the width you choose (or keep only the fine detail). Then invert the acuity model: what viewing distance would make the eye's foveal blur equal that width, given the painting's real width in centimeters? That is the readout.

### Scanpath lens

Your cursor stands in for the fovea (the moving-window idea from McConkie and Rayner, used in the BubbleView method of Kim et al. 2017). For 30 seconds the page records the cursor, finds fixations with the dispersion-threshold algorithm I-DT (Salvucci and Goldberg 2000), and can draw them as a path, as a dwell heat map, or against a model.

The model is a simplified Itti, Koch and Niebur (1998) bottom-up saliency map built from lightness, color and orientation contrast, with a winner-take-all selection and inhibition of return to produce a model scanpath. **NSS** (Peters et al. 2005) scores how well the model predicts where you looked: the model's mean z-score at your fixations, where zero is chance. Run the same painting under two tasks and the model, which knows nothing about your task, scores them differently if your task changed where you looked. That is Yarbus in miniature.

### Where things live

```
index.html            page structure
css/style.css         layout, type, small-screen behavior
js/main.js            state, UI, the four lenses, recording
js/viewer.js          WebGL2 renderer and the foveation shader
js/imageops.js        all the math, with no DOM (blur, Lab, isoluminance, saliency, fixations)
js/content.js         the essays, task lists, references
data/paintings.json   the six works, sizes, sources, credits
scripts/fetch_paintings.py   downloads and crops the images
tests/imageops.test.js       unit tests for the math
```

`imageops.js` is kept free of browser code on purpose so it can be tested in Node.

## What I checked against real paintings

I tested the pipeline on synthetic fixtures first, then ran the real analysis code on the actual Wikimedia reproductions in Chrome. Three things came out of that.

**The Monet claim holds in this reproduction.** The sun (a disc around its center) measures L* 59.0, a* 38, b* 27. The haze just to its left measures L* 57.4, a* -4, b* -6. That is a lightness difference of 1.6 and a color difference of 53. Other spots around the sun give lightness differences of 0.4 to 4.4.

**The ranking of "how isoluminant is each painting" depends on a threshold, and I am not going to pretend otherwise.** Share of strong color edges that are isoluminant, at six thresholds (1.5, 2, 3, 4, 6, 8), measured at 560 px on the reproductions the site uses:

| Painting | 1.5 | 2 | 3 | 4 | 6 | 8 |
|---|---|---|---|---|---|---|
| Monet, *Impression, Sunrise* | 22% | 29% | 52% | 73% | 93% | 97% |
| Seurat, *La Grande Jatte* (crop) | 31% | 34% | 40% | 43% | 40% | 35% |
| Van Gogh, *Starry Night* | 20% | 22% | 26% | 29% | 33% | 38% |
| Repin, *They Did Not Expect Him* | 8% | 8% | 7% | 8% | 10% | 9% |
| Leonardo, *Mona Lisa* | 7% | 5% | 3% | 2% | 1% | 0% |
| Caravaggio, *Calling of St Matthew* | 1% | 1% | 1% | 1% | 2% | 3% |

At low thresholds, brushwork and canvas texture count as edges and the top three blur together, with Seurat ahead of Monet at 2. From 3 up, Monet leads. The bottom of the table does not move: Leonardo, Caravaggio and Repin sit low at every threshold. I set the site's default threshold to 4 after seeing this table, so treat the top of the ranking as suggestive and the bottom as sturdier. Six reproductions are not a sample, and reproductions differ in color calibration.

**The Seurat distance is in the tens of meters.** It depends a little on the resolution of the source image. With the 3-pixel blur preset it comes out around 24 to 29 meters.

## Limits

- A mouse is not an eye, thirty seconds is not three minutes, and one viewer is not a study.
- The acuity model describes detection of gratings at the retina. It does not model crowding, attention, or anything the cortex does with the signal.
- Livingstone's two-pathway story is a strong simplification of primate vision. The link between equal lightness and shimmer is a hypothesis. The Luminance lens can test whether the sun and sky match in lightness. It cannot test whether that causes the flicker.
- Saliency is bottom-up only. It knows nothing about faces, text, or what the viewer was asked to do.
- Reproductions are not paintings. Scale, gloss, craquelure and the room are all missing.

## Run it locally

You need a static file server. From the project folder:

```
python3 -m http.server 8000
```

then open http://localhost:8000.

The site works without any local image files: if `assets/paintings/` is empty it falls back to the Wikimedia thumbnails listed in `data/paintings.json`. To store the images in the repo (faster, and works if Wikimedia is slow), run once:

```
pip install pillow
python3 scripts/fetch_paintings.py
```

It downloads each work, crops the Seurat detail, resizes, and writes `assets/paintings/CREDITS.md`.

To run the tests (Node 18 or newer, no dependencies):

```
npm test
```

You can also drop in your own photograph of a painting with the file picker on the page. It is processed in your browser and never uploaded.

## Deploying

It is pre-built static files, so GitHub Pages serves it as is. In the repo settings, set Pages to deploy from the `main` branch root. The `.nojekyll` file keeps Pages from processing the folders.

## Credits

All six paintings are in the public domain (the artists died in 1930 or earlier), reproduced through Wikimedia Commons. File pages and licenses are listed in the page under "Image credits" and in `assets/paintings/CREDITS.md` after you run the fetch script.

Fonts: EB Garamond and Atkinson Hyperlegible, both under the SIL Open Font License 1.1, bundled from the Fontsource packages (see `assets/fonts/LICENSE-fonts.md`).

## References

- Margaret Livingstone, *Vision and Art: The Biology of Seeing* (Abrams, 2002).
- Margaret Livingstone, "Is it warm? Is it real? Or just low spatial frequency?" *Science* 290 (2000): 1299.
- Louis Leroy, "L'Exposition des impressionnistes," *Le Charivari*, 25 April 1874.
- Michel-Eugène Chevreul, *De la loi du contraste simultané des couleurs* (Paris, 1839).
- Ogden N. Rood, *Modern Chromatics* (New York: Appleton, 1879).
- Martin Kemp, *The Science of Art: Optical Themes in Western Art from Brunelleschi to Seurat* (Yale University Press, 1990).
- Alfred L. Yarbus, *Eye Movements and Vision* (New York: Plenum Press, 1967).
- Michelle R. Greene, Tommy Liu and Jeremy M. Wolfe, "Reconsidering Yarbus: A failure to predict observers' task from eye movement patterns," *Vision Research* 62 (2012): 1 to 8.
- Ali Borji and Laurent Itti, "Defending Yarbus: Eye movements reveal observers' task," *Journal of Vision* 14, no. 3 (2014): 29.
- Nam Wook Kim et al., "BubbleView: An interface for crowdsourcing image importance maps and tracking visual attention," *ACM Transactions on Computer-Human Interaction* 24, no. 5 (2017).
- Wilson S. Geisler and Jeffrey S. Perry, "A real-time foveated multiresolution system for low-bandwidth video communication," *Proceedings of SPIE* 3299 (1998).
- Laurent Itti, Christof Koch and Ernst Niebur, "A model of saliency-based visual attention for rapid scene analysis," *IEEE TPAMI* 20, no. 11 (1998): 1254 to 1259.
- Dario D. Salvucci and Joseph H. Goldberg, "Identifying fixations and saccades in eye-tracking protocols," *Proceedings of ETRA* (2000).
- Robert J. Peters et al., "Components of bottom-up gaze allocation in natural images," *Vision Research* 45 (2005): 2397 to 2416.
- John Hyman, "Art and neuroscience," in *Beyond Mimesis and Convention*, ed. Roman Frigg and Matthew Hunter (Springer, 2010).
- John Onians, *Neuroarthistory: From Aristotle and Pliny to Baxandall and Zeki* (Yale University Press, 2016).

## How this connects to the course

TODO (Radhik): add two or three sentences on the Harvard Art Museums visit (which work you stood in front of, and what the lens made you notice about it) and which in-class exercises this builds on.

TODO (Radhik): add a line on how you built it and what tools or AI help you used, in whatever form the course asks for.
