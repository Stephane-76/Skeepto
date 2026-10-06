import React from 'react';
import { SkComponent } from './SkComponent';

// Must match RECORD_IMAGE_INLINE_MAX_BYTES on the server.
const INLINE_MAX_BYTES = 256 * 1024;
const MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_PREVIEW_SIZE = { width: '240px', height: '160px' };
const DEFAULT_THUMB_SIZE = { width: '48px', height: '28px' };

function imageFrameStyle(sizeImage, fallback) {
    const width = sizeImage?.width || sizeImage?.Width || fallback.width;
    const height = sizeImage?.height || sizeImage?.Height || fallback.height;
    return { width, height };
}

const ALLOWED = [
    { mime: 'image/png', ext: '.png' },
    { mime: 'image/jpeg', ext: '.jpg' },
    { mime: 'image/jpeg', ext: '.jpeg' },
    { mime: 'image/gif', ext: '.gif' },
    { mime: 'image/webp', ext: '.webp' },
    { mime: 'image/svg+xml', ext: '.svg' },
];

function mimeOf(file) {
    const name = String(file?.name || '').toLowerCase();
    const declared = String(file?.type || '').toLowerCase();
    if (declared === 'image/jpg') {
        return 'image/jpeg';
    }
    const known = ALLOWED.find((item) => item.mime === declared || name.endsWith(item.ext));
    return known ? known.mime : '';
}

function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Could not read the image'));
        reader.readAsDataURL(file);
    });
}

function authHeaders() {
    return {
        authorization: 'Bearer ' + window.sessionStorage.getItem('jwt'),
    };
}

async function fetchGridFsObjectUrl(gridfsId) {
    const response = await fetch('/mdb/image/' + encodeURIComponent(gridfsId), {
        headers: authHeaders(),
    });
    if (!response.ok) {
        throw new Error('Image not found');
    }
    const blob = await response.blob();
    return URL.createObjectURL(blob);
}

export class SkRecordImageThumb extends SkComponent {
    constructor(props) {
        super(props);
        this.state = { src: '' };
        this._objectUrl = '';
    }

    componentDidMount() {
        this.load(this.props.value);
    }

    componentDidUpdate(prevProps) {
        if (prevProps.value !== this.props.value) {
            this.load(this.props.value);
        }
    }

    componentWillUnmount() {
        this.revoke();
    }

    revoke() {
        if (this._objectUrl) {
            URL.revokeObjectURL(this._objectUrl);
            this._objectUrl = '';
        }
    }

    load = async (value) => {
        this.revoke();
        if (!value) {
            this.setState({ src: '' });
            return;
        }
        if (typeof value === 'string' && value.startsWith('data:image/')) {
            this.setState({ src: value });
            return;
        }
        if (value.storage === 'inline' && value.data) {
            this.setState({ src: value.data });
            return;
        }
        if (value.storage === 'gridfs' && value.gridfsId) {
            try {
                const src = await fetchGridFsObjectUrl(value.gridfsId);
                this._objectUrl = src;
                this.setState({ src });
            } catch {
                this.setState({ src: '' });
            }
            return;
        }
        this.setState({ src: '' });
    }

    render() {
        if (!this.state.src) {
            return null;
        }
        return (
            <img
                className="SkImageField-thumb"
                alt=""
                src={this.state.src}
                style={imageFrameStyle(this.props.sizeImage, DEFAULT_THUMB_SIZE)}
            />
        );
    }
}

export class SkImageField extends SkComponent {
    constructor(props) {
        super(props);
        this.state = {
            descriptor: null,
            previewUrl: '',
            error: '',
            enabled: true,
            busy: false,
        };
        this._objectUrl = '';
        this._previewToken = 0;
    }

    componentWillUnmount() {
        this.revoke();
    }

    revoke() {
        if (this._objectUrl) {
            URL.revokeObjectURL(this._objectUrl);
            this._objectUrl = '';
        }
    }

    value() {
        return this.state.descriptor || '';
    }

    setEnabled = (enabled) => {
        this.setState({ enabled: Boolean(enabled) });
    }

    notify = () => {
        if (this.props.onChange) {
            this.props.onChange({
                target: {
                    id: this.props.id,
                    value: this.value(),
                },
            });
        }
    }

    setValue(value) {
        const token = ++this._previewToken;
        this.revoke();
        if (!value) {
            this.setState({ descriptor: null, previewUrl: '', error: '' });
            return;
        }
        if (typeof value === 'string' && value.startsWith('data:image/')) {
            this.setState({
                descriptor: { storage: 'inline', mime: '', name: '', data: value },
                previewUrl: value,
                error: '',
            });
            return;
        }
        if (value.storage === 'inline' && value.data) {
            this.setState({ descriptor: value, previewUrl: value.data, error: '' });
            return;
        }
        if (value.storage === 'gridfs' && value.gridfsId) {
            this.setState({ descriptor: value, previewUrl: '', error: '' }, () => {
                this.loadGridFsPreview(value.gridfsId, token);
            });
            return;
        }
        this.setState({ descriptor: null, previewUrl: '', error: '' });
    }

    loadGridFsPreview = async (gridfsId, token) => {
        try {
            const src = await fetchGridFsObjectUrl(gridfsId);
            if (token !== this._previewToken) {
                URL.revokeObjectURL(src);
                return;
            }
            this.revoke();
            this._objectUrl = src;
            this.setState({ previewUrl: src });
        } catch (error) {
            if (token !== this._previewToken) {
                return;
            }
            this.setState({ error: error?.message || 'Image not found' });
        }
    }

    onFile = async (event) => {
        const file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (!file || !this.state.enabled) {
            return;
        }
        const mime = mimeOf(file);
        if (!mime) {
            this.setState({ error: 'Use a PNG, JPEG, GIF, WebP or SVG image.' });
            return;
        }
        if (file.size > MAX_BYTES) {
            this.setState({ error: 'Image is larger than 16MB.' });
            return;
        }
        this.setState({ busy: true, error: '' });
        try {
            const dataUrl = await readAsDataUrl(file);
            let descriptor;
            if (file.size <= INLINE_MAX_BYTES) {
                descriptor = { storage: 'inline', mime, name: file.name, data: dataUrl };
            } else {
                const raw = await window.WebInterface.postJson('/mdb/image', JSON.stringify({
                    mime,
                    name: file.name,
                    data: dataUrl,
                }));
                const result = JSON.parse(raw);
                if (!result || result.message !== 'success' || !result.image) {
                    throw new Error(result?.error || 'Could not store the image');
                }
                descriptor = result.image;
            }
            this.revoke();
            this.setState({
                descriptor,
                previewUrl: dataUrl,
                busy: false,
                error: '',
            }, this.notify);
        } catch (error) {
            this.setState({
                busy: false,
                error: error?.message || 'Could not store the image',
            });
        }
    }

    clear = () => {
        if (!this.state.enabled) {
            return;
        }
        this.revoke();
        this.setState({ descriptor: null, previewUrl: '', error: '' }, this.notify);
    }

    render() {
        const { previewUrl, error, enabled, busy, descriptor } = this.state;
        const accept = ALLOWED.map((item) => item.mime).filter((mime, index, list) => list.indexOf(mime) === index).join(',')
            + ',.svg,.png,.jpg,.jpeg,.gif,.webp';
        return (
            <div className="SkImageField">
                {previewUrl ? (
                    <img
                        className="SkImageField-preview"
                        alt={descriptor?.name || ''}
                        src={previewUrl}
                        style={imageFrameStyle(this.props.sizeImage, DEFAULT_PREVIEW_SIZE)}
                    />
                ) : null}
                <div className="SkImageField-actions">
                    <label className={enabled && !busy ? 'SkImageField-pick' : 'SkImageField-pick SkImageField-pick-disabled'}>
                        {busy ? 'Uploading…' : 'Choose image'}
                        <input
                            type="file"
                            accept={accept}
                            disabled={!enabled || busy}
                            onChange={this.onFile}
                        />
                    </label>
                    {descriptor && enabled ? (
                        <button type="button" className="SkImageField-clear" onClick={this.clear}>
                            Remove
                        </button>
                    ) : null}
                </div>
                <div className="text-muted">PNG, JPEG, GIF, WebP or SVG.</div>
                {error ? <div className="SkImageField-error">{error}</div> : null}
            </div>
        );
    }
}

export default SkImageField;
