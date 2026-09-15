// Custom toolbar hints. Native HTML title tooltips are unreliable in Electron
// at the top of the window (Chromium draws them above the button, where the
// macOS title bar clips them). This host paints a body-level tip below the
// control and strips title= so the native popup never starts.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './SkToolbarHint.css';

const SHOW_DELAY_MS = 280;
const EDGE_PAD = 8;
const GAP_BELOW = 6;

const SKIP_CLOSEST =
  '.SkSpTopCommand-popup, .SkMenuPopUp, .Sk-font-selector-dropdown, .Sk-size-selector-dropdown, .SkColor__dropdown';

function disarmNativeTitle(el) {
  if (!el || !el.getAttribute) return '';
  const existing = (el.getAttribute('data-sk-hint') || '').trim();
  const native = (el.getAttribute('title') || '').trim();
  if (native) {
    el.setAttribute('data-sk-hint', native);
    el.removeAttribute('title');
    return native;
  }
  return existing;
}

function hintHostFrom(target, root) {
  if (!target || !root || !root.contains(target)) return null;
  if (target.closest && target.closest(SKIP_CLOSEST)) return null;
  const host = target.closest('[title], [data-sk-hint]');
  if (!host || !root.contains(host)) return null;
  if (host.closest(SKIP_CLOSEST)) return null;
  return host;
}

function clampPosition(node, x, y) {
  if (!node) return;
  const rect = node.getBoundingClientRect();
  let left = x;
  let top = y;
  const half = rect.width / 2;
  if (left - half < EDGE_PAD) left = EDGE_PAD + half;
  if (left + half > window.innerWidth - EDGE_PAD) {
    left = window.innerWidth - EDGE_PAD - half;
  }
  if (top + rect.height > window.innerHeight - EDGE_PAD) {
    top = Math.max(EDGE_PAD, window.innerHeight - EDGE_PAD - rect.height);
  }
  node.style.left = `${Math.round(left)}px`;
  node.style.top = `${Math.round(top)}px`;
}

export default function SkToolbarHint() {
  const markerRef = useRef(null);
  const tipNodeRef = useRef(null);
  const [tip, setTip] = useState(null);

  useEffect(() => {
    const root = markerRef.current && markerRef.current.parentElement;
    if (!root) return undefined;

    let timer = null;
    let currentHost = null;

    const hide = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      currentHost = null;
      setTip(null);
    };

    const disarmToolbarTitles = () => {
      root.querySelectorAll('[title]').forEach((el) => {
        if (el.closest(SKIP_CLOSEST)) return;
        disarmNativeTitle(el);
      });
    };

    const showFor = (host, text) => {
      const rect = host.getBoundingClientRect();
      setTip({
        text,
        x: rect.left + rect.width / 2,
        y: rect.bottom + GAP_BELOW,
      });
    };

    const onOver = (event) => {
      disarmToolbarTitles();
      const host = hintHostFrom(event.target, root);
      if (!host) {
        hide();
        return;
      }
      const text = disarmNativeTitle(host);
      if (!text) {
        hide();
        return;
      }
      if (host === currentHost) return;
      if (timer) clearTimeout(timer);
      currentHost = host;
      setTip(null);
      timer = setTimeout(() => {
        if (currentHost === host) showFor(host, text);
      }, SHOW_DELAY_MS);
    };

    disarmToolbarTitles();
    root.addEventListener('pointerover', onOver);
    root.addEventListener('pointerleave', hide);
    root.addEventListener('pointerdown', hide);
    window.addEventListener('blur', hide);

    return () => {
      hide();
      root.removeEventListener('pointerover', onOver);
      root.removeEventListener('pointerleave', hide);
      root.removeEventListener('pointerdown', hide);
      window.removeEventListener('blur', hide);
    };
  }, []);

  useEffect(() => {
    if (tip) clampPosition(tipNodeRef.current, tip.x, tip.y);
  }, [tip]);

  return (
    <>
      <span ref={markerRef} className="SkToolbarHint-marker" aria-hidden="true" />
      {tip && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={(node) => {
                tipNodeRef.current = node;
                if (node && tip) clampPosition(node, tip.x, tip.y);
              }}
              className="SkToolbarHint"
              role="tooltip"
              style={{ left: tip.x, top: tip.y }}
            >
              {tip.text}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
