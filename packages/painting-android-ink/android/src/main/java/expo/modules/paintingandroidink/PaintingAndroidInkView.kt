package expo.modules.paintingandroidink

import android.content.Context
import android.graphics.Color
import android.os.Build
import android.view.MotionEvent
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.widget.LinearLayout
import androidx.ink.authoring.InProgressStrokeId
import androidx.ink.authoring.InProgressStrokesFinishedListener
import androidx.ink.authoring.InProgressStrokesView
import androidx.ink.brush.Brush
import androidx.ink.brush.StockBrushes
import androidx.ink.strokes.Stroke
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

// Standalone A0 probe only. No raw samples, document commits, or WebView routing.
class PaintingAndroidInkView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true
  private val onReady by EventDispatcher()
  private val onStrokeFinished by EventDispatcher()
  private val onRetired by EventDispatcher()
  private val onCancelled by EventDispatcher()
  private val ink = InProgressStrokesView(context)
  private val ids = mutableMapOf<InProgressStrokeId, Int>()
  private val finished = mutableSetOf<InProgressStrokeId>()
  private var nextId = 1
  private var owner = -1
  private var active: InProgressStrokeId? = null
  private var sampleCount = 0

  init {
    setBackgroundColor(Color.TRANSPARENT)
    ink.setBackgroundColor(Color.TRANSPARENT)
    if (Build.VERSION.SDK_INT >= 33) isAutoHandwritingEnabled = false
    addView(ink, LinearLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
    ink.addFinishedStrokesListener(object : InProgressStrokesFinishedListener {
      override fun onStrokesFinished(strokes: Map<InProgressStrokeId, Stroke>) {
        for (strokeId in strokes.keys) {
          val id = ids[strokeId]
          if (id == null) {
            ink.removeFinishedStrokes(setOf(strokeId))
          } else {
            finished.add(strokeId)
            onStrokeFinished(mapOf("id" to id))
          }
        }
      }
    })
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    cancelActive("layout-changed")
    if (w > 0 && h > 0) {
      onReady(mapOf(
        "probeVersion" to 1,
        "inkVersion" to "1.0.0",
        "sdkInt" to Build.VERSION.SDK_INT,
        "density" to resources.displayMetrics.density,
        "widthPx" to w,
        "heightPx" to h
      ))
    }
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    val action = event.actionMasked
    val index = event.actionIndex
    if (active == null) {
      if (action != MotionEvent.ACTION_DOWN && action != MotionEvent.ACTION_POINTER_DOWN) return false
      if (event.getToolType(index) != MotionEvent.TOOL_TYPE_STYLUS || event.buttonState != 0) return false
      if (ids.size >= 4) return false
      owner = event.getPointerId(index)
      sampleCount = 1
      val density = resources.displayMetrics.density
      val brush = Brush.createWithColorIntArgb(
        StockBrushes.pressurePen(), 0x80225648.toInt(), 4f * density, 0.1f * density
      )
      val strokeId = ink.startStroke(event, owner, brush)
      active = strokeId
      ids[strokeId] = nextId++
      requestUnbufferedDispatch(event)
      return true
    }

    val strokeId = active ?: return false
    val ownerIndex = event.findPointerIndex(owner)
    if (action == MotionEvent.ACTION_CANCEL || ownerIndex < 0 || event.buttonState != 0) {
      cancelActive("system-cancel")
      return true
    }
    val ownerUp = (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_POINTER_UP) &&
      event.getPointerId(index) == owner
    if (ownerUp && event.flags and MotionEvent.FLAG_CANCELED != 0) {
      cancelActive("pointer-cancel")
      return true
    }
    if (action == MotionEvent.ACTION_MOVE || ownerUp) {
      sampleCount += event.historySize + 1
      if (sampleCount > 50_000) {
        cancelActive("sample-limit")
      } else if (ownerUp) {
        ink.finishStroke(event, owner, strokeId)
        active = null
        owner = -1
      } else {
        ink.addToStroke(event, owner, strokeId)
      }
    }
    return true
  }

  fun retire(id: Int) {
    val strokeId = finished.firstOrNull { ids[it] == id } ?: return
    ink.removeFinishedStrokes(setOf(strokeId))
    finished.remove(strokeId)
    ids.remove(strokeId)
    onRetired(mapOf("id" to id))
  }

  private fun cancelActive(reason: String) {
    val strokeId = active ?: return
    val id = ids.remove(strokeId)
    ink.cancelStroke(strokeId)
    active = null
    owner = -1
    if (id != null) onCancelled(mapOf("id" to id, "reason" to reason))
  }

  override fun onWindowVisibilityChanged(visibility: Int) {
    super.onWindowVisibilityChanged(visibility)
    if (visibility != VISIBLE) cancelActive("not-visible")
  }

  override fun onDetachedFromWindow() {
    cancelActive("detached")
    ink.removeFinishedStrokes(finished.toSet())
    finished.clear()
    ids.clear()
    super.onDetachedFromWindow()
  }
}
