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

## 4. Selection control anatomy

- Resize handles are 10 px square in screen space and remain constant while zooming.
- The rotation handle sits 24 px above the selection box, connected by a 2 px blue line.
- The rotation handle is a 14 px visible circle with a 24 px transparent pointer target.
- Pointer cursors communicate direct manipulation: resize cursors on resize handles and `grab` on the rotation handle.

## 5. Interaction and motion

- Selection transforms track pointer movement directly through `@system-ui-js/multi-drag`.
- Rotation is calculated around the visible selection-box center.
- Rectangles and ellipses retain their local width and height while their center and persisted angle rotate.
- Motion is functional only. Do not add easing, bounce, or decorative transitions to drawing transforms.

## 6. Responsive behavior

- Handle and connector dimensions are defined in screen pixels and divided by viewport scale.
- The selection geometry and transformed strokes remain in canvas coordinates.
- The pointer target must not shrink below 24 px as the canvas zoom changes.

## 7. Accessibility constraints

- Visible handles maintain blue-on-white contrast and do not rely on fill alone to communicate selection.
- Pointer targets support mouse, pen, and touch through the canvas input-method contract.
- Accepted debt: canvas transform handles, including the existing resize controls, do not yet expose keyboard rotation or resize. A future keyboard interaction must add complete behavior and focus treatment rather than a non-functional button role.

## 8. Review contract

- Verify the rotation handle at representative desktop and narrow viewport widths.
- Verify rotation with a freehand stroke and a closed shape.
- Verify the browser console remains free of new errors during selection and rotation.
