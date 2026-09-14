import React from 'react';
import SkModal from './SkModal';
import SkAboutContent from '../SkAboutContent';

function SkAboutModal({ show, onClose }) {
  if (!show) {
    return null;
  }

  const openFullPage = () => {
    window.open('/about', '_blank', 'noopener,noreferrer');
  };

  return (
    <SkModal
      show={show}
      title="About Skeepto"
      width={720}
      height={560}
      closeButton
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="SkModal-toolbarBtn SkModal-toolbarBtn--secondary"
            onClick={openFullPage}
          >
            Full page
          </button>
          <button
            type="button"
            className="SkModal-toolbarBtn SkModal-toolbarBtn--primary"
            onClick={onClose}
          >
            Close
          </button>
        </>
      }
    >
      <div className="SkAboutModal-intro">
        <p className="SkAboutModal-tagline">Embeddable spreadsheet engine</p>
      </div>
      <SkAboutContent compact />
    </SkModal>
  );
}

export default SkAboutModal;
