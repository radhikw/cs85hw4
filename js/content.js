// content.js
// The art-historical writing, the task lists and the reference list.
// Strings are HTML written by the author of this project, never user input.

export const REFS = {
  livingstone2002: 'Margaret Livingstone, <i>Vision and Art: The Biology of Seeing</i> (Abrams, 2002).',
  livingstone2000: 'Margaret Livingstone, “Is it warm? Is it real? Or just low spatial frequency?” <i>Science</i> 290 (2000): 1299.',
  leroy1874: 'Louis Leroy, “L’Exposition des impressionnistes,” <i>Le Charivari</i>, 25 April 1874.',
  chevreul1839: 'Michel-Eugène Chevreul, <i>De la loi du contraste simultané des couleurs</i> (Paris, 1839).',
  rood1879: 'Ogden N. Rood, <i>Modern Chromatics</i> (New York: Appleton, 1879).',
  kemp1990: 'Martin Kemp, <i>The Science of Art: Optical Themes in Western Art from Brunelleschi to Seurat</i> (Yale University Press, 1990).',
  yarbus1967: 'Alfred L. Yarbus, <i>Eye Movements and Vision</i> (New York: Plenum Press, 1967).',
  greene2012: 'Michelle R. Greene, Tommy Liu and Jeremy M. Wolfe, “Reconsidering Yarbus: A failure to predict observers’ task from eye movement patterns,” <i>Vision Research</i> 62 (2012): 1–8.',
  borji2014: 'Ali Borji and Laurent Itti, “Defending Yarbus: Eye movements reveal observers’ task,” <i>Journal of Vision</i> 14, no. 3 (2014): 29.',
  kim2017: 'Nam Wook Kim et al., “BubbleView: An interface for crowdsourcing image importance maps and tracking visual attention,” <i>ACM Transactions on Computer-Human Interaction</i> 24, no. 5 (2017).',
  geisler1998: 'Wilson S. Geisler and Jeffrey S. Perry, “A real-time foveated multiresolution system for low-bandwidth video communication,” <i>Proceedings of SPIE</i> 3299 (1998).',
  itti1998: 'Laurent Itti, Christof Koch and Ernst Niebur, “A model of saliency-based visual attention for rapid scene analysis,” <i>IEEE Transactions on Pattern Analysis and Machine Intelligence</i> 20, no. 11 (1998): 1254–1259.',
  salvucci2000: 'Dario D. Salvucci and Joseph H. Goldberg, “Identifying fixations and saccades in eye-tracking protocols,” <i>Proceedings of ETRA</i> (2000).',
  peters2005: 'Robert J. Peters et al., “Components of bottom-up gaze allocation in natural images,” <i>Vision Research</i> 45 (2005): 2397–2416.',
  hyman2010: 'John Hyman, “Art and neuroscience,” in <i>Beyond Mimesis and Convention</i>, ed. Roman Frigg and Matthew Hunter (Springer, 2010).',
  onians2016: 'John Onians, <i>Neuroarthistory: From Aristotle and Pliny to Baxandall and Zeki</i> (Yale University Press, 2016).',
  harmon1973: 'Leon D. Harmon, “The recognition of faces,” <i>Scientific American</i> 229, no. 5 (1973): 71–82.',
};

// Short forms for the "Sources" line under each essay.
export const CITES = {
  livingstone2002: 'Livingstone 2002', livingstone2000: 'Livingstone 2000', leroy1874: 'Leroy 1874',
  chevreul1839: 'Chevreul 1839', rood1879: 'Rood 1879', kemp1990: 'Kemp 1990', yarbus1967: 'Yarbus 1967',
  greene2012: 'Greene, Liu and Wolfe 2012', borji2014: 'Borji and Itti 2014', kim2017: 'Kim et al. 2017',
  geisler1998: 'Geisler and Perry 1998', itti1998: 'Itti, Koch and Niebur 1998', salvucci2000: 'Salvucci and Goldberg 2000',
  peters2005: 'Peters et al. 2005', hyman2010: 'Hyman 2010', onians2016: 'Onians 2016', harmon1973: 'Harmon 1973',
};

export const GENERIC_TASKS = [
  'Look freely',
  'Find where the light comes from',
  'Count the human figures',
];

export const CASES = {
  'impression-sunrise': {
    headline: 'A sun you can only see in color',
    body: [
      '<p>Monet painted this view of the harbor at Le Havre in 1872. When it hung in the independent exhibition of 1874, the critic Louis Leroy mocked it in a satirical review for <i>Le Charivari</i>, and the painting’s title gave the group its name: the Impressionists.</p>',
      '<p>Margaret Livingstone points to something a black-and-white photograph destroys. The orange sun and the grey-blue haze around it have almost the same lightness. In the reproduction used here the sun measures L* 59 and the haze beside it about 57 on a scale of 0 to 100, while their colors are far apart. Strip out the color and the sun nearly disappears. The third button below puts the probe on the sun and on the haze. Click anywhere to measure other spots.</p>',
      '<p>Her explanation is a division of labor in the visual system. One pathway is sensitive to color and supports recognizing things. Another is color-blind and cares about lightness, and it supports locating things and judging motion and depth. Where only color separates two shapes, she argues, the second pathway cannot place the boundary, so the shape seems to float or flicker. That would account for the shimmer of Impressionist surfaces.</p>',
      '<p>Treat this as a strong simplification. Primate vision has more than two pathways, and the link between equal lightness and shimmer is a hypothesis about perception. The lens lets you test the first half, whether the sun and sky really match in lightness, in the reproduction in front of you.</p>',
      '<p>The subject is part of the argument. The harbor holds cranes, smokestacks and steam, and the sun is a few quick strokes. The title announces that this is a record of a perceptual moment, not of a place.</p>',
    ],
    tasks: ['Look freely', 'Find the sun', 'Count the boats'],
    presets: [
      { label: 'Compare with lightness only', lens: 'luminance', set: { lumView: 'lum', split: 0.5, iso: false } },
      { label: 'Mark the isoluminance edges', lens: 'luminance', set: { lumView: 'color', split: 1, iso: true } },
      { label: 'Measure the sun against the sky', lens: 'luminance', set: { lumView: 'color', split: 1, iso: false, probe: true, probesFrac: [[0.61, 0.308], [0.565, 0.308]] } },
    ],
    sources: ['livingstone2002', 'leroy1874'],
  },

  'mona-lisa': {
    headline: 'A smile that moves when you look at it',
    body: [
      '<p>Leonardo began the portrait around 1503 and still had it with him when he died in 1519. Its signature technique is <i>sfumato</i>: contours dissolved by thin glazes, so that light turns to shade with no line between them. Critics often single out the corners of the mouth and eyes as the places where it works hardest.</p>',
      '<p>Livingstone argues that the smile belongs to the coarse patterns of light and dark, the low spatial frequencies. Peripheral vision carries those patterns well. When you look straight at the mouth, you pick up the fine detail of the lips, and the smile gets weaker. That would explain why it seems to come and go as your eyes move.</p>',
      '<p>Try it two ways. In the Distance lens, blur the painting and watch the mouth. In the Fovea lens, fixate on the eyes and look at the mouth only in your periphery. At the scale of a real face the peripheral effect is small, so raise the falloff slider to see the idea.</p>',
      '<p>The approach has critics. John Hyman, a philosopher of art, argues that brain science explains how we see a picture but not what makes it good or what it meant to its first viewers. John Onians, an art historian, argues the reverse: that art history needs the brain. The lenses show a mechanism. They do not settle which of them is right.</p>',
    ],
    tasks: ['Look freely', 'Judge her expression', 'Find where the light comes from'],
    presets: [
      { label: 'Blur the face', lens: 'distance', set: { sigma: 7, freqMode: 'blur' } },
      { label: 'Fixate the eyes, read the mouth', lens: 'fovea', set: { fixFrac: [0.47, 0.235], falloff: 12, fov: 6 } },
    ],
    sources: ['livingstone2000', 'livingstone2002', 'hyman2010', 'onians2016'],
  },

  'la-grande-jatte': {
    headline: 'Dots that were meant to mix in your eye',
    body: [
      '<p>Seurat worked on <i>A Sunday on La Grande Jatte</i> from 1884 to 1886 and showed it at the last Impressionist exhibition. He built it from small touches of separate colors, a method critics called pointillism and Seurat’s circle called divisionism.</p>',
      '<p>The method came from color theory. Chevreul had described simultaneous contrast in 1839: a color shifts toward the complement of its neighbor. Ogden Rood’s <i>Modern Chromatics</i> (1879) gave painters a practical account of mixing light. Seurat’s bet was that unmixed dots of orange and blue-green would blend in the viewer’s eye at a distance and look brighter than the same color mixed on a palette.</p>',
      '<p>The Distance lens tests the bet with arithmetic. This crop is about 74 cm wide on the real canvas. Drag the blur up and the page reports how far away you would have to stand for your central vision to blur the dots that much. The answer is tens of meters, far past any gallery wall. At normal range the dots stay separate, and what you see is vibration between neighboring colors, not a smooth mixture.</p>',
      '<p>That fits the scholarly picture, which treats Seurat’s optical mixing as a theory he held more firmly than the painting delivers. The surface still does something unusual: it never settles into a single color.</p>',
    ],
    tasks: ['Look freely', 'Find the white dress', 'Count the human figures'],
    presets: [
      { label: 'Step back', lens: 'distance', set: { sigma: 3, freqMode: 'blur' } },
      { label: 'Keep only the fine detail', lens: 'distance', set: { sigma: 3, freqMode: 'detail' } },
    ],
    sources: ['chevreul1839', 'rood1879', 'kemp1990'],
  },

  'unexpected-visitor': {
    headline: 'One painting, seven questions',
    body: [
      '<p>Repin painted this between 1884 and 1888. A political exile, probably one of the populist revolutionaries called narodniks, walks into a room where his family did not expect to see him again. Repin belonged to the Wanderers, Russian realists who painted social subjects. Here the story depends on faces: each figure reacts differently, so viewers have to read the room to follow it.</p>',
      '<p>In the 1950s and 60s Alfred Yarbus recorded where people looked in this painting under seven instructions: look freely, estimate the family’s wealth, give the ages of the people, say what the family had been doing before the visitor arrived, remember their clothes, remember where people and objects were, and estimate how long the visitor had been away. His traces looked different for each task. The figure became the standard illustration of the claim that what we want to know steers where we look.</p>',
      '<p>The claim is contested. Greene, Liu and Wolfe (2012) could not predict the task from simple statistics of the eye movements. Borji and Itti (2014) later could, with better methods. The strong version, that you can read the task off the scanpath, is still open.</p>',
      '<p>The Scanpath lens lets you run a small version. Your cursor becomes a fovea, in the manner of the BubbleView method that uses a blurred image to collect attention data, and the lens logs where you dwell. Pick a task, explore for thirty seconds, then compare your fixations with a bottom-up saliency model that knows nothing about the task.</p>',
    ],
    tasks: [
      'Look freely',
      'Estimate the material circumstances of the family',
      'Give the ages of the people',
      'Guess what the family was doing before the visitor arrived',
      'Remember the clothes the people are wearing',
      'Remember the positions of the people and objects in the room',
      'Estimate how long the visitor has been away from the family',
    ],
    presets: [
      { label: 'Go to the Scanpath lens', lens: 'scanpath', set: {} },
    ],
    sources: ['yarbus1967', 'greene2012', 'borji2014', 'kim2017', 'itti1998'],
  },

  'calling-of-st-matthew': {
    headline: 'A painting made of lightness edges',
    body: [
      '<p>Caravaggio painted this for the Contarelli Chapel in San Luigi dei Francesi, Rome, in 1599 and 1600. Christ points at the tax collector Matthew in a dim room, and a beam of light enters from the upper right. The style is called tenebrism: deep darkness, with figures cut out of it by light.</p>',
      '<p>Monet separates shapes by color. Caravaggio separates them by lightness. Run the isoluminance finder on both. If Livingstone’s two-system picture is right, this should be a painting whose structure survives conversion to black and white, and the finder should mark far fewer edges here than on the Monet.</p>',
      '<p>Use “Compare the paintings” in the Luminance lens to see all six side by side. Read the bars as a prompt, not a result. Six reproductions with different color calibration are not a sample, and the measure counts edges, not meaning.</p>',
    ],
    tasks: ['Look freely', 'Find where the light comes from', 'Count the human figures'],
    presets: [
      { label: 'Mark the isoluminance edges', lens: 'luminance', set: { lumView: 'color', split: 1, iso: true } },
      { label: 'Compare the paintings', lens: 'luminance', set: { lumView: 'color', split: 1, iso: false, compare: true } },
    ],
    sources: ['livingstone2002'],
  },

  'starry-night': {
    headline: 'No claim here, so look for yourself',
    body: [
      '<p>Van Gogh painted <i>The Starry Night</i> in June 1889 while he was a patient at the asylum of Saint-Paul-de-Mausole in Saint-Rémy-de-Provence. The view from his window is joined to a village he imagined.</p>',
      '<p>This painting has no case study. It is here so you can try the lenses without an argument attached. Do the halos around the stars survive in the lightness-only view? Where does the saliency model send your eyes first, and does it match where the swirl sends yours?</p>',
    ],
    tasks: GENERIC_TASKS,
    presets: [
      { label: 'Lightness only', lens: 'luminance', set: { lumView: 'lum', split: 0.5, iso: false } },
      { label: 'Fovea lens', lens: 'fovea', set: {} },
    ],
    sources: [],
  },
};

export const LENS_NOTES = {
  fovea: 'Central vision is sharp over a small patch. Away from it, the finest detail you can resolve falls off quickly. Move your cursor, or drag a finger, to place the fixation point.',
  luminance: 'A pixel has a lightness and a color. Many edges in paintings carry both. Some carry only color. Those are the edges a lightness-sensitive pathway cannot see.',
  distance: 'Stepping back removes fine detail and leaves coarse patterns of light and dark. Many effects in painting live in one band or the other.',
  scanpath: 'Where you dwell says what you are trying to find out. Your cursor is the fovea. Everything else is blurred.',
};
