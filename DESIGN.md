# Painting Interaction Design

## 1. Product brief

Painting is an operational drawing surface. Controls must stay visually quiet so the artwork remains primary, while selected content has clear direct-manipulation affordances for moving, resizing, and rotating.

## 2. Primary user

The primary user edits strokes with a mouse, pen, or touch input and expects selection transforms to follow the pointer immediately. Precision and predictable geometry are more important than decorative motion.

## 3. Visual tokens

- Selection blue: `rgb(59, 130, 246)`.
- Selection preview fill: `rgba(59, 130, 246, 0.1)`.
- Active selection fill: `rgba(59, 130, 246, 0.2)`.
- Handle surface: white with a 2 px selection-blue outline.
- Selection outline: 3 px, `4 4` dash pattern, non-scaling stroke.
- Selection geometry padding: 8 canvas units.
- Stroke-color presets: black `#000000`, blue `#2563eb`, red `#dc2626`, green `#16a34a`, orange `#ea580c`, and purple `#9333ea`.
- Stroke-color swatches are 20 px circles with a white outline; the selected row uses the existing accent treatment, and custom color selection uses the browser-native color input.
- Text-size presets are 12, 16, 20, 24, 32, and 48 canvas units; 24 is the default.
- The ruler is a 48 px-high screen-space strip clipped to the drawing-surface host. Its rendered length exceeds twice the host diagonal, so neither endpoint can enter the visible canvas.
- Ruler marks mirror across the top and bottom edges, using three line-height levels for 1 mm, 5 mm, and 10 mm intervals. The ruler contains no numeric or textual labels.
- Transient interaction feedback uses a white surface with black, tabular numeric text. Ruler angle feedback is a 44 px circle; mouse zoom feedback is a compact 32 px-high pill with a minimum width of 48 px, while touch zoom feedback is fixed at 64 × 32 px so viewport clamping uses its exact rendered bounds.
- Minimap uses an 8 px canvas-edge inset. A built-in bottom toolbar uses a 32 px container-edge inset; bottom-left and bottom-right Minimap positions clear the 42 px toolbar surface with an additional 8 px gap.

## 4. Selection control anatomy

- Resize handles are 10 px square in screen space and remain constant while zooming.
- The rotation handle sits 24 px above the selection box, connected by a 2 px blue line.
- The rotation handle is a 14 px visible circle with a 24 px transparent pointer target.
- Pointer cursors communicate direct manipulation: resize cursors on resize handles and `grab` on the rotation handle.
- A single selected text box uses only left and right resize handles. They reuse the 10 px white surface and 2 px selection-blue outline, remain screen-sized while zooming, and change only the corresponding horizontal boundary.

## 5. Interaction and motion

- Selection transforms track pointer movement directly through `@system-ui-js/multi-drag`.
- Rotation is calculated around the visible selection-box center.
- Rectangles and ellipses retain their local width and height while their center and persisted angle rotate.
- Motion is functional only. Do not add easing, bounce, or decorative transitions to drawing transforms.
- Undo and redo are the first two actions at the far left of the bottom toolbar. They remain visible but disabled when their action is unavailable, so history state never changes the toolbar layout.
- A bottom toolbar shared by multiple PaintingBoard instances owns one chronological history stack; undo and redo follow operation order across boards rather than maintaining independent per-board stacks.
- Clicking an empty point in text mode places a text box at that canvas position and starts editing it. Clicking an existing text box in text mode selects and edits it.
- Text boxes are selectable only in text mode, when enclosed by a lasso, or when clicked while the lasso tool is active. Switching to an ordinary drawing or eraser tool clears that selection context.
- Text mode exposes text color and font size in the bottom toolbar; stroke width and pressure controls are hidden because they do not apply to text.
- The ruler stores a logical origin and clockwise rotation in host-local CSS pixels/radians. Canvas pan and zoom never change them; `Ctrl`/`Cmd` + left drag translates the origin, while mouse `Alt` + left drag rotates the ruler as a rigid body around the midpoint of its viewport-clipped centerline. Two ruler-owned touches retain the original `@system-ui-js/multi-drag` translation and rotation behavior. An unmodified mouse drag never moves the ruler.
- Mouse and touch rotation snap to the nearest 45-degree multiple only within the configured angular tolerance. The ruler overlay stays below both Minimap and the bottom toolbar while retaining ruler gesture ownership in their overlap.
- PaintingBoard exposes ruler visibility in its bottom More menu, with controlled and uncontrolled visibility following the same contract as Minimap without replacing ruler geometry or visual options.
- Ruler marks do not receive pointer events. Wheel input over the ruler remains available to virtual-paper navigation.
- While the ruler rotates, its current whole-degree angle appears at a gesture-fixed point. Mouse rotation captures the midpoint of the viewport-clipped ruler centerline when rotation begins; touch rotation projects the initial two-touch midpoint onto the ruler centerline. The angle updates without moving that point, remains upright, and disappears when rotation ends; ordinary ruler translation does not show it.
- Drawing gestures choose the physical ruler edge nearest their starting side. Before crossing that edge, points remain unconstrained; after crossing it, points project onto that edge only while the raw pointer remains inside the ruler strip. Leaving the strip keeps that outside sample raw and re-arms the constraint from the side where the pointer landed, so a later entry during the same gesture can snap to the newly approached physical edge. A sparse sample that jumps across the complete strip never fabricates an intermediate constrained point.
- Virtual-paper zoom shows the real returned scale rounded to a whole percent. Mouse-wheel feedback appears above the pointer, or below it when the upper placement would clip. Two-finger feedback starts from the upper normal-line intersection, remains within 50 px of the finger midpoint, and keeps the complete feedback pill inside the visible host.
- Interaction feedback appears and updates directly without decorative entrance or exit motion. Touch feedback ends with the pinch; wheel feedback clears shortly after the final wheel update.
- Minimap viewport-border resize is mouse-only. Touch and pen drags that begin on the border retain viewport panning without changing scale.

## 6. Responsive behavior

- Handle and connector dimensions are defined in screen pixels and divided by viewport scale.
- The selection geometry and transformed strokes remain in canvas coordinates.
- The pointer target must not shrink below 24 px as the canvas zoom changes.
- Stroke-color and stroke-width controls remain directly available beside the compact tool selector; their menus open above the bottom toolbar and must stay inside a 375 px viewport.
- In text mode, color and font-size controls replace stroke width and remain directly available beside the compact tool selector at 375 px.
- The ruler remains clipped to the host with constant screen-space height, mark spacing, and line hierarchy in ordinary and virtual-paper modes at every canvas viewport scale. Moving along its axis changes the tick phase without exposing an endpoint.

## 7. Accessibility constraints

- Visible handles maintain blue-on-white contrast and do not rely on fill alone to communicate selection.
- Pointer targets support mouse, pen, and touch through the canvas input-method contract.
- Color swatches expose text labels and selected state; color is never the only accessible identifier.
- Accepted debt: canvas transform handles, including the existing resize controls, do not yet expose keyboard rotation or resize. A future keyboard interaction must add complete behavior and focus treatment rather than a non-functional button role.
- The ruler's unlabeled marks are a spatial alignment aid rather than a standalone measurement readout; consumers that require spoken or numeric measurements must provide that information outside this decorative overlay.

## 8. Review contract

- Verify the rotation handle at representative desktop and narrow viewport widths.
- Verify rotation with a freehand stroke and a closed shape.
- Verify the browser console remains free of new errors during selection and rotation.
- Verify all six fixed stroke colors, the custom-color input, real stroke output, lasso visibility, and menu containment at 375 px, 768 px, and 1280 px widths.
- Verify undo and redo button order, disabled states, and chronological behavior when one bottom toolbar controls two PaintingBoard instances.
- Verify text placement at the pointer, editing, all six font-size presets, color changes, lasso enclosure and click selection, and independent left/right boundary dragging at 375 px, 768 px, and 1280 px widths.
- Verify canvas pan and zoom leave the ruler layout unchanged, no pixels escape the drawing host, neither endpoint appears after extreme translation or rotation, top and bottom ticks mirror without text, the ruler remains below Minimap and the bottom toolbar, unmodified mouse drags do not move it, Ctrl/Cmd translation still works, mouse rotation uses the clipped centerline midpoint, touch retains its original two-point multi-drag behavior, and both inputs snap only near 45-degree multiples.
- Verify mouse, pen, and drawing-owned touch gestures select the nearer ruler edge, project onto that edge while inside the strip, keep the first outside sample unconstrained, and snap again from the opposite side when the same gesture later re-enters.
- Verify mouse ruler rotation keeps the upright white-circle whole-degree readout at its gesture-start clipped-centerline midpoint, touch rotation keeps it at the initial two-touch midpoint's centerline projection, and ruler translation shows no readout.
- Verify Ctrl/Cmd wheel zoom shows the real whole-percent scale above the pointer with the top-edge fallback below, and two-finger zoom keeps the same scale within 50 px of the midpoint and fully inside the visible host until either finger ends.
- Verify the PaintingBoard bottom-bar ruler switch preserves supplied ruler options and respects controlled visibility at 375 px, 768 px, and 1280 px widths.
- Verify all four Minimap initialization corners, bottom-toolbar clearance, the 32 px toolbar inset, mouse border resize, and touch/pen border panning without scale changes.
