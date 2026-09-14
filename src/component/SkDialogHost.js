import React from 'react';
import SkModal from './SkModal.js';
import {
  registerSkDialogHost,
  unregisterSkDialogHost,
} from '../skDialog.js';

const VARIANT_CLASS = {
  info: 'SkDialog--info',
  error: 'SkDialog--error',
  success: 'SkDialog--success',
  warning: 'SkDialog--warning',
};

/**
 * App-level host for showAlert / showConfirm (see skDialog.js).
 */
class SkDialogHost extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      alertOpen: false,
      alertPayload: null,
      confirmOpen: false,
      confirmPayload: null,
    };
  }

  componentDidMount() {
    registerSkDialogHost({
      showAlert: this.showAlert,
      showConfirm: this.showConfirm,
    });
  }

  componentWillUnmount() {
    unregisterSkDialogHost();
  }

  showAlert = ({
    title = 'Information',
    message = '',
    detail = '',
    okLabel = 'OK',
    variant = 'info',
  } = {}) =>
    new Promise((resolve) => {
      this.setState({
        alertOpen: true,
        alertPayload: { title, message, detail, okLabel, variant, resolve },
      });
    });

  showConfirm = ({
    title = 'Confirmation',
    message = '',
    detail = '',
    confirmLabel = 'Confirmer',
    cancelLabel = 'Annuler',
    variant = 'warning',
    danger = false,
  } = {}) =>
    new Promise((resolve) => {
      this.setState({
        confirmOpen: true,
        confirmPayload: {
          title,
          message,
          detail,
          confirmLabel,
          cancelLabel,
          variant,
          danger,
          resolve,
        },
      });
    });

  closeAlert = () => {
    const resolve = this.state.alertPayload?.resolve;
    this.setState({ alertOpen: false, alertPayload: null }, () => {
      resolve?.();
    });
  };

  closeConfirm = (confirmed) => {
    const resolve = this.state.confirmPayload?.resolve;
    this.setState({ confirmOpen: false, confirmPayload: null }, () => {
      resolve?.(confirmed);
    });
  };

  renderDialogBody(payload) {
    if (!payload) return null;
    const variantClass = VARIANT_CLASS[payload.variant] || VARIANT_CLASS.info;
    return (
      <div className={`SkDialog ${variantClass}`}>
        {payload.message ? (
          <p className="SkDialog-message">{payload.message}</p>
        ) : null}
        {payload.detail ? (
          <p className="SkDialog-detail">{payload.detail}</p>
        ) : null}
      </div>
    );
  }

  render() {
    const { alertOpen, alertPayload, confirmOpen, confirmPayload } = this.state;

    return (
      <>
        <SkModal
          show={alertOpen}
          title={alertPayload?.title || 'Information'}
          width={440}
          height={alertPayload?.detail ? 260 : 220}
          closeButton={false}
          footer={
            <button
              type="button"
              className={`SkModal-toolbarBtn ${
                alertPayload?.variant === 'error'
                  ? 'SkModal-toolbarBtn--danger'
                  : 'SkModal-toolbarBtn--primary'
              }`}
              onClick={this.closeAlert}
            >
              {alertPayload?.okLabel || 'OK'}
            </button>
          }
        >
          {this.renderDialogBody(alertPayload)}
        </SkModal>

        <SkModal
          show={confirmOpen}
          title={confirmPayload?.title || 'Confirmation'}
          width={460}
          height={confirmPayload?.detail ? 280 : 240}
          closeButton={false}
          footer={
            <>
              <button
                type="button"
                className="SkModal-toolbarBtn SkModal-toolbarBtn--secondary"
                onClick={() => this.closeConfirm(false)}
              >
                {confirmPayload?.cancelLabel || 'Annuler'}
              </button>
              <button
                type="button"
                className={`SkModal-toolbarBtn ${
                  confirmPayload?.danger
                    ? 'SkModal-toolbarBtn--danger'
                    : 'SkModal-toolbarBtn--primary'
                }`}
                onClick={() => this.closeConfirm(true)}
              >
                {confirmPayload?.confirmLabel || 'Confirmer'}
              </button>
            </>
          }
        >
          {this.renderDialogBody(confirmPayload)}
        </SkModal>
      </>
    );
  }
}

export default SkDialogHost;
