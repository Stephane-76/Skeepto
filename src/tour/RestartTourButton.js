import React from 'react';

/**
 * RestartTourButton - small helper button to relaunch the guided tour.
 *
 * Drop it anywhere (Help menu, Settings page, footer...). It calls the
 * global hook installed by <GuidedTour /> so it stays decoupled from the
 * tour internals.
 */
export function RestartTourButton({ children = 'Replay the tour', className, style }) {
  const handleClick = () => {
    if (typeof window.__skerStartTour === 'function') {
      window.__skerStartTour();
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={className}
      style={style}
      title="Replay the guided tour"
    >
      {children}
    </button>
  );
}

export default RestartTourButton;
