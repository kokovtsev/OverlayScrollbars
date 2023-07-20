import {
  directionIsRTL,
  getBoundingClientRect,
  offsetSize,
  on,
  preventDefault,
  runEachAndClear,
  stopPropagation,
  selfClearTimeout,
  parent,
  closest,
  push,
  attrClass,
  noop,
  getTrasformTranslateValue,
} from '~/support';
import { getPlugins, clickScrollPluginName } from '~/plugins';
import { getEnvironment } from '~/environment';
import {
  classNameScrollbarHandle,
  classNameScrollbarInteraction,
  classNameScrollbarWheel,
  dataAttributeHost,
  dataValueHostScrollbarPressed,
} from '~/classnames';
import type { XY } from '~/support';
import type { ClickScrollPluginInstance } from '~/plugins';
import type { ReadonlyOptions } from '~/options';
import type { StructureSetupState } from '~/setups';
import type {
  ScrollbarsSetupElementsObj,
  ScrollbarStructure,
} from '~/setups/scrollbarsSetup/scrollbarsSetup.elements';

export type ScrollbarsSetupEvents = (
  scrollbarStructure: ScrollbarStructure,
  scrollbarsAddRemoveClass: ScrollbarsSetupElementsObj['_scrollbarsAddRemoveClass'],
  documentElm: Document,
  hostElm: HTMLElement,
  scrollOffsetElm: HTMLElement,
  scrollTimeline: AnimationTimeline | null,
  isHorizontal?: boolean
) => () => void;

const { round } = Math;
const getScale = (element: HTMLElement): XY<number> => {
  const { width, height } = getBoundingClientRect(element);
  const { w, h } = offsetSize(element);
  return {
    x: round(width) / w || 1,
    y: round(height) / h || 1,
  };
};
const continuePointerDown = (
  event: PointerEvent,
  options: ReadonlyOptions,
  isDragScroll: boolean
) => {
  const scrollbarOptions = options.scrollbars;
  const { button, isPrimary, pointerType } = event;
  const { pointers } = scrollbarOptions;
  return (
    button === 0 &&
    isPrimary &&
    scrollbarOptions[isDragScroll ? 'dragScroll' : 'clickScroll'] &&
    (pointers || []).includes(pointerType)
  );
};
const releasePointerCaptureEvents = 'pointerup pointerleave pointercancel lostpointercapture';
const getScrollTimelineTransformKeyFrames = (isHorizontal?: boolean) => [
  getTrasformTranslateValue(`0%`, isHorizontal),
  getTrasformTranslateValue('-100%', isHorizontal),
];
const scrollTimelineLeftTopKeyFrames = ['0%', '100%'];
const scrollTimelineXAnimation = {
  transform: getScrollTimelineTransformKeyFrames(true),
  left: scrollTimelineLeftTopKeyFrames,
};
const scrollTimelineYAnimation = {
  transform: getScrollTimelineTransformKeyFrames(),
  top: scrollTimelineLeftTopKeyFrames,
};

const createRootClickStopPropagationEvents = (scrollbar: HTMLElement, documentElm: Document) =>
  on(
    scrollbar,
    'mousedown',
    on.bind(0, documentElm, 'click', stopPropagation, { _once: true, _capture: true }),
    { _capture: true }
  );

const createInteractiveScrollEvents = (
  options: ReadonlyOptions,
  hostElm: HTMLElement,
  documentElm: Document,
  scrollbarStructure: ScrollbarStructure,
  scrollOffsetElement: HTMLElement,
  structureSetupState: () => StructureSetupState,
  isHorizontal?: boolean
) => {
  const { _rtlScrollBehavior } = getEnvironment();
  const { _handle, _track, _scrollbar } = scrollbarStructure;
  const scrollLeftTopKey = `scroll${isHorizontal ? 'Left' : 'Top'}` as 'scrollLeft' | 'scrollTop';
  const clientXYKey = `client${isHorizontal ? 'X' : 'Y'}` as 'clientX' | 'clientY'; // for pointer event (can't use xy because of IE11)
  const widthHeightKey = isHorizontal ? 'width' : 'height';
  const leftTopKey = isHorizontal ? 'left' : 'top'; // for BCR (can't use xy because of IE11)
  const whKey = isHorizontal ? 'w' : 'h';
  const xyKey = isHorizontal ? 'x' : 'y';

  const createRelativeHandleMove =
    (mouseDownScroll: number, invertedScale: number) => (deltaMovement: number) => {
      const { _overflowAmount } = structureSetupState();
      const handleTrackDiff = offsetSize(_track)[whKey] - offsetSize(_handle)[whKey];
      const scrollDeltaPercent = (invertedScale * deltaMovement) / handleTrackDiff;
      const scrollDelta = scrollDeltaPercent * _overflowAmount[xyKey];
      const isRTL = directionIsRTL(_scrollbar);
      const negateMultiplactor =
        isRTL && isHorizontal ? (_rtlScrollBehavior.n || _rtlScrollBehavior.i ? 1 : -1) : 1;

      scrollOffsetElement[scrollLeftTopKey] = mouseDownScroll + scrollDelta * negateMultiplactor;
    };

  return on(_track, 'pointerdown', (pointerDownEvent: PointerEvent) => {
    const isDragScroll =
      closest(pointerDownEvent.target as Node, `.${classNameScrollbarHandle}`) === _handle;
    const pointerCaptureElement = isDragScroll ? _handle : _track;
    attrClass(hostElm, dataAttributeHost, dataValueHostScrollbarPressed, true);

    if (continuePointerDown(pointerDownEvent, options, isDragScroll)) {
      const instantClickScroll = !isDragScroll && pointerDownEvent.shiftKey;
      const getHandleRect = () => getBoundingClientRect(_handle);
      const getTrackRect = () => getBoundingClientRect(_track);
      const getHandleOffset = (handleRect?: DOMRect, trackRect?: DOMRect) =>
        (handleRect || getHandleRect())[leftTopKey] - (trackRect || getTrackRect())[leftTopKey];
      const moveHandleRelative = createRelativeHandleMove(
        scrollOffsetElement[scrollLeftTopKey] || 0,
        1 / getScale(scrollOffsetElement)[xyKey]
      );
      const pointerDownOffset = pointerDownEvent[clientXYKey];
      const handleRect = getHandleRect();
      const trackRect = getTrackRect();
      const handleLength = handleRect[widthHeightKey];
      const handleCenter = getHandleOffset(handleRect, trackRect) + handleLength / 2;
      const relativeTrackPointerOffset = pointerDownOffset - trackRect[leftTopKey];
      const startOffset = isDragScroll ? 0 : relativeTrackPointerOffset - handleCenter;
      const releasePointerCapture = (pointerUpEvent: PointerEvent) => {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        runEachAndClear(offFns);
        pointerCaptureElement.releasePointerCapture(pointerUpEvent.pointerId);
      };

      const offFns = [
        attrClass.bind(0, hostElm, dataAttributeHost, dataValueHostScrollbarPressed),
        on(documentElm, releasePointerCaptureEvents, releasePointerCapture),
        on(documentElm, 'selectstart', (event: Event) => preventDefault(event), {
          _passive: false,
        }),
        on(_track, releasePointerCaptureEvents, releasePointerCapture),
        on(_track, 'pointermove', (pointerMoveEvent: PointerEvent) => {
          const relativeMovement = pointerMoveEvent[clientXYKey] - pointerDownOffset;

          if (isDragScroll || instantClickScroll) {
            moveHandleRelative(startOffset + relativeMovement);
          }
        }),
      ];

      if (instantClickScroll) {
        moveHandleRelative(startOffset);
      } else if (!isDragScroll) {
        const clickScrollPlugin = getPlugins()[clickScrollPluginName] as
          | ClickScrollPluginInstance
          | undefined;

        if (clickScrollPlugin) {
          push(
            offFns,
            clickScrollPlugin._(
              moveHandleRelative,
              getHandleOffset,
              startOffset,
              handleLength,
              relativeTrackPointerOffset
            )
          );
        }
      }

      pointerCaptureElement.setPointerCapture(pointerDownEvent.pointerId);
    }
  });
};

const createScrollTimelineEvents = (
  { _handle }: ScrollbarStructure,
  scrollTimeline: AnimationTimeline | null,
  isHorizontal?: boolean
) => {
  if (!scrollTimeline) {
    return noop;
  }

  const handleAnimation = _handle.animate(
    isHorizontal ? scrollTimelineXAnimation : scrollTimelineYAnimation,
    {
      // @ts-ignore
      timeline: scrollTimeline,
    }
  );

  return () => {
    handleAnimation.cancel();
  };
};

export const createScrollbarsSetupEvents =
  (
    options: ReadonlyOptions,
    structureSetupState: () => StructureSetupState
  ): ScrollbarsSetupEvents =>
  (
    scrollbarStructure,
    scrollbarsAddRemoveClass,
    documentElm,
    hostElm,
    scrollOffsetElm,
    scrollTimeline,
    isHorizontal
  ) => {
    const { _scrollbar } = scrollbarStructure;
    const [wheelTimeout, clearScrollTimeout] = selfClearTimeout(333);
    const scrollByFn = !!scrollOffsetElm.scrollBy;
    let wheelScrollBy = true;

    return runEachAndClear.bind(0, [
      on(_scrollbar, 'pointerenter', () => {
        scrollbarsAddRemoveClass(classNameScrollbarInteraction, true);
      }),
      on(_scrollbar, 'pointerleave pointercancel', () => {
        scrollbarsAddRemoveClass(classNameScrollbarInteraction);
      }),
      on(
        _scrollbar,
        'wheel',
        (wheelEvent: WheelEvent) => {
          const { deltaX, deltaY, deltaMode } = wheelEvent;

          // the first wheel event is swallowed, simulate scroll to compensate for it
          if (scrollByFn && wheelScrollBy && deltaMode === 0 && parent(_scrollbar) === hostElm) {
            scrollOffsetElm.scrollBy({
              left: deltaX,
              top: deltaY,
              behavior: 'smooth',
            });
          }

          wheelScrollBy = false;
          scrollbarsAddRemoveClass(classNameScrollbarWheel, true);
          wheelTimeout(() => {
            wheelScrollBy = true;
            scrollbarsAddRemoveClass(classNameScrollbarWheel);
          });

          preventDefault(wheelEvent);
        },
        { _passive: false, _capture: true }
      ),
      createRootClickStopPropagationEvents(_scrollbar, documentElm),
      createInteractiveScrollEvents(
        options,
        hostElm,
        documentElm,
        scrollbarStructure,
        scrollOffsetElm,
        structureSetupState,
        isHorizontal
      ),
      createScrollTimelineEvents(scrollbarStructure, scrollTimeline, isHorizontal),
      clearScrollTimeout,
    ]);
  };
