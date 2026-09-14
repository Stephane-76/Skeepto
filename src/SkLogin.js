import React from 'react';
import { Link } from 'react-router-dom';
import SkComponent from './component/SkComponent';
import SkInput from './component/SkInput';
import SkButton from './component/SkButton';
import SkPassWord from './component/SkPassWord';
import SkThemeFlipToggle from './component/SkThemeFlipToggle';
import { ensureDefaultVirtualDiskPathForUser } from './virtualDiskHomePath';
import { ReactComponent as SkeeptoLogo } from './SkLogo.svg';

const EMPTY_FORM = {
    mode: 'login',
    name: '',
    firstName: '',
    email: '',
    password: '',
    verificationCode: '',
    error: '',
    success: '',
    isLoading: false,
    lockUntil: 0,
    lockedEmail: '',
};

function formatLockoutWait(remainingMs) {
    const totalSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0 && seconds > 0) {
        return `${minutes} min ${seconds} s`;
    }
    if (minutes > 0) {
        return `${minutes} min`;
    }
    return `${seconds} s`;
}

class SkLogin extends SkComponent {
    constructor(props) {
        super(props);
        this.state = { ...EMPTY_FORM };
        this.lockTimer = null;
    }

    componentDidMount() {
        if (this.props.show) {
            document.body.style.overflow = 'hidden';
        }
    }

    componentDidUpdate(prevProps) {
        if (prevProps.show !== this.props.show) {
            if (!this.props.show) {
                this.clearLockTimer();
                this.setState({ ...EMPTY_FORM });
                document.body.style.overflow = 'unset';
            } else {
                document.body.style.overflow = 'hidden';
            }
        }
    }

    componentWillUnmount() {
        this.clearLockTimer();
        document.body.style.overflow = 'unset';
    }

    clearLockTimer = () => {
        if (this.lockTimer) {
            clearInterval(this.lockTimer);
            this.lockTimer = null;
        }
    };

    startLockCountdown = (lockUntil, lockedEmail) => {
        this.clearLockTimer();
        const tick = () => {
            const remainingMs = lockUntil - Date.now();
            if (remainingMs <= 0) {
                this.clearLockTimer();
                this.setState({
                    lockUntil: 0,
                    lockedEmail: '',
                    error: 'You can try to sign in again.',
                });
                return;
            }
            this.setState((prev) => ({
                lockUntil,
                lockedEmail,
                error:
                    prev.mode === 'register'
                        ? prev.error
                        : `Too many failed login attempts. Try again in ${formatLockoutWait(remainingMs)}.`,
            }));
        };
        tick();
        this.lockTimer = setInterval(tick, 1000);
    };

    setMode = (mode) => {
        if (mode === 'verify') {
            this.setState({
                mode,
                verificationCode: '',
                error: '',
            });
            return;
        }
        this.setState({
            mode,
            name: '',
            firstName: '',
            email: mode === 'login' ? this.state.email : '',
            password: '',
            verificationCode: '',
            error: '',
            success: '',
        });
    };

    handleSubmit = async (e) => {
        e.preventDefault();
        if (this.state.mode === 'register') {
            await this.handleRegister();
        } else if (this.state.mode === 'verify') {
            await this.handleVerify();
        } else {
            await this.handleLogin();
        }
    };

    handleLogin = async () => {
        const lockedEmail = String(this.state.email || '').trim().toLowerCase();
        if (this.state.lockUntil > Date.now() && lockedEmail === this.state.lockedEmail) {
            return;
        }

        this.setState({ isLoading: true, error: '', success: '' });

        try {
            const response = await fetch("/login", {
                method: "POST",
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email: this.state.email,
                    password: this.state.password
                })
            });

            const result = await response.json();

            if (response.ok && result.status === 'success') {
                const wUser = result.user.FirstName + " " + result.user.Name;

                this.clearLockTimer();
                sessionStorage.setItem("user", wUser);
                sessionStorage.setItem("email", result.user.Email);
                sessionStorage.setItem("name", result.user.Name);
                sessionStorage.setItem("firstname", result.user.FirstName);
                sessionStorage.setItem("jwt", result.token);
                sessionStorage.setItem("group", result.user.Group);
                ensureDefaultVirtualDiskPathForUser(result.user.Email);
                if (this.props.onLoginSuccess) {
                    this.props.onLoginSuccess();
                }
                this.setState({ show: false, lockUntil: 0, lockedEmail: '' });
            } else if (result.needsVerification) {
                this.setState({
                    mode: 'verify',
                    verificationCode: '',
                    error: '',
                    success: result.message || 'Enter the verification code sent to your email',
                });
            } else if (result.retryAfterSeconds) {
                const lockedEmail = String(this.state.email || '').trim().toLowerCase();
                this.startLockCountdown(
                    Date.now() + result.retryAfterSeconds * 1000,
                    lockedEmail
                );
            } else {
                this.setState({ error: result.message || 'Invalid email or password' });
            }
        } catch (error) {
            this.setState({ error: 'Server connection error' });
            console.error("Login error:", error);
        } finally {
            this.setState({ isLoading: false });
        }
    };

    handleRegister = async () => {
        this.setState({ isLoading: true, error: '', success: '' });

        try {
            const response = await fetch("/register", {
                method: "POST",
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: this.state.name,
                    firstName: this.state.firstName,
                    email: this.state.email,
                    password: this.state.password,
                })
            });

            const result = await response.json();

            if (response.ok && result.status === 'success') {
                this.setState({
                    mode: 'verify',
                    name: '',
                    firstName: '',
                    verificationCode: '',
                    error: '',
                    success: result.message || 'We sent a verification code to your email.',
                    isLoading: false,
                });
            } else if (result.needsVerification) {
                this.setState({
                    mode: 'verify',
                    verificationCode: '',
                    error: result.message || 'Enter the verification code sent to your email',
                    success: '',
                    isLoading: false,
                });
            } else {
                this.setState({
                    error: result.message || 'Unable to create account',
                    isLoading: false,
                });
            }
        } catch (error) {
            this.setState({ error: 'Server connection error', isLoading: false });
            console.error("Registration error:", error);
        }
    };

    handleVerify = async () => {
        this.setState({ isLoading: true, error: '', success: '' });

        try {
            const response = await fetch('/register/verify', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    email: this.state.email,
                    code: this.state.verificationCode,
                }),
            });

            const result = await response.json();

            if (response.ok && result.status === 'success') {
                if (this.state.password) {
                    await this.handleLogin();
                    return;
                }
                this.setState({
                    mode: 'login',
                    verificationCode: '',
                    error: '',
                    success: result.message || 'Email verified. You can sign in now.',
                    isLoading: false,
                });
            } else {
                this.setState({
                    error: result.message || 'Invalid verification code',
                    isLoading: false,
                });
            }
        } catch (error) {
            this.setState({ error: 'Server connection error', isLoading: false });
            console.error('Verification error:', error);
        }
    };

    handleResend = async () => {
        this.setState({ isLoading: true, error: '', success: '' });

        try {
            const response = await fetch('/register/resend', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    email: this.state.email,
                }),
            });

            const result = await response.json();
            if (response.ok && result.status === 'success') {
                this.setState({
                    success: result.message || 'We sent a new verification code to your email',
                    isLoading: false,
                });
            } else {
                this.setState({
                    error: result.message || 'Unable to resend the verification code',
                    isLoading: false,
                });
            }
        } catch (error) {
            this.setState({ error: 'Server connection error', isLoading: false });
            console.error('Resend verification error:', error);
        }
    };

    handleChange = (e) => {
        if (e.target.id === 'verificationCode') {
            this.setState({
                verificationCode: String(e.target.value || '').replace(/\D/g, '').slice(0, 6),
            });
            return;
        }
        this.setState({ [e.target.id]: e.target.value });
    };

    render() {
        const { show } = this.props;
        const {
            mode,
            name,
            firstName,
            email,
            password,
            verificationCode,
            error,
            success,
            isLoading,
            lockUntil,
            lockedEmail,
        } = this.state;
        const isRegister = mode === 'register';
        const isVerify = mode === 'verify';
        const isLoginLocked =
            mode === 'login' &&
            lockUntil > Date.now() &&
            String(email || '').trim().toLowerCase() === lockedEmail;

        if (!show) return null;

        const cardTitle = isVerify
            ? 'Verify your email'
            : (isRegister ? 'Create account' : 'Login');
        const submitLabel = isLoading
            ? (isVerify ? 'Verifying...' : (isRegister ? 'Creating account...' : 'Logging in...'))
            : (isVerify ? 'Confirm code' : (isRegister ? 'Create account' : 'Login'));

        return (
            <div className="SkLogin-shell">
                <header className="SkLogin-brand">
                    <div className="SkLogin-brandRow">
                        <div className="SkLogin-brandIdentity">
                            <SkeeptoLogo className="SkLogin-brandLogo" />
                            <div className="SkLogin-brandText">
                                <h1 className="SkLogin-brandTitle">Skeepto</h1>
                                <p className="SkLogin-brandSubtitle">Online spreadsheet workspace</p>
                            </div>
                        </div>
                        <div className="SkLogin-brandActions">
                            <Link to="/about" className="SkLogin-aboutBtn">
                                About Skeepto
                            </Link>
                            <SkThemeFlipToggle />
                        </div>
                    </div>
                </header>

                <main className="SkLogin-main">
                    <div className="SkLogin-mainStack">
                    <div className="SkLogin-card">
                        <h2 className="SkLogin-cardTitle">
                            {cardTitle}
                        </h2>

                        {!isVerify && (
                        <div className="SkLogin-modeToggle" role="tablist" aria-label="Authentication mode">
                            <button
                                type="button"
                                role="tab"
                                aria-selected={!isRegister}
                                className={`SkLogin-modeBtn${!isRegister ? ' SkLogin-modeBtn--active' : ''}`}
                                onClick={() => this.setMode('login')}
                                disabled={isLoading}
                            >
                                Sign in
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={isRegister}
                                className={`SkLogin-modeBtn${isRegister ? ' SkLogin-modeBtn--active' : ''}`}
                                onClick={() => this.setMode('register')}
                                disabled={isLoading}
                            >
                                Register
                            </button>
                        </div>
                        )}

                        <form onSubmit={this.handleSubmit} className="SkLogin-form">
                            {isVerify && (
                                <>
                                    <p className="SkLogin-verifyHint">
                                        Enter the 6-digit code sent to <strong>{email}</strong>
                                    </p>
                                    <div className="SkLogin-field">
                                        <label htmlFor="verificationCode">Verification code</label>
                                        <SkInput
                                            type="text"
                                            id="verificationCode"
                                            name="verificationCode"
                                            value={verificationCode}
                                            onChange={this.handleChange}
                                            placeholder="000000"
                                            required
                                        />
                                    </div>
                                </>
                            )}

                            {isRegister && (
                                <>
                                    <div className="SkLogin-field">
                                        <label htmlFor="name">Last name</label>
                                        <SkInput
                                            type="text"
                                            id="name"
                                            name="name"
                                            value={name}
                                            onChange={this.handleChange}
                                            placeholder="Enter your last name"
                                            required
                                        />
                                    </div>

                                    <div className="SkLogin-field">
                                        <label htmlFor="firstName">First name</label>
                                        <SkInput
                                            type="text"
                                            id="firstName"
                                            name="firstName"
                                            value={firstName}
                                            onChange={this.handleChange}
                                            placeholder="Enter your first name"
                                            required
                                        />
                                    </div>
                                </>
                            )}

                            {!isVerify && (
                            <div className="SkLogin-field">
                                <label htmlFor="email">Email</label>
                                <SkInput
                                    type="email"
                                    id="email"
                                    name="email"
                                    value={email}
                                    onChange={this.handleChange}
                                    placeholder="Enter your email"
                                    required
                                />
                            </div>
                            )}

                            {!isVerify && (
                            <div className="SkLogin-field">
                                <label htmlFor="password">Password</label>
                                <SkPassWord
                                    id="password"
                                    name="password"
                                    value={password}
                                    onChange={this.handleChange}
                                    placeholder={isRegister
                                        ? 'Min. 8 chars, upper, lower, number'
                                        : 'Enter your password'}
                                    required
                                />
                            </div>
                            )}

                            {success && (
                                <div className="SkLogin-success" role="status">
                                    {success}
                                </div>
                            )}

                            {error && (
                                <div className="SkLogin-error" role="alert">
                                    {error}
                                </div>
                            )}

                            <div className="SkLogin-actions">
                                <SkButton
                                    type="submit"
                                    disabled={isLoading || isLoginLocked || (isVerify && String(verificationCode).length !== 6)}
                                    className="SkLogin-submit"
                                >
                                    {submitLabel}
                                </SkButton>
                            </div>

                            {isVerify && (
                                <p className="SkLogin-switchMode">
                                    Did not receive the email?{' '}
                                    <button
                                        type="button"
                                        className="SkLogin-switchModeLink"
                                        onClick={this.handleResend}
                                        disabled={isLoading}
                                    >
                                        Resend code
                                    </button>
                                    <br />
                                    <button
                                        type="button"
                                        className="SkLogin-switchModeLink"
                                        onClick={() => this.setMode('login')}
                                        disabled={isLoading}
                                    >
                                        Back to sign in
                                    </button>
                                </p>
                            )}

                            {!isVerify && !isRegister && (
                                <p className="SkLogin-switchMode">
                                    No account yet?{' '}
                                    <button
                                        type="button"
                                        className="SkLogin-switchModeLink"
                                        onClick={() => this.setMode('register')}
                                        disabled={isLoading}
                                    >
                                        Create one
                                    </button>
                                </p>
                            )}

                            {!isVerify && isRegister && (
                                <p className="SkLogin-switchMode">
                                    Already registered?{' '}
                                    <button
                                        type="button"
                                        className="SkLogin-switchModeLink"
                                        onClick={() => this.setMode('login')}
                                        disabled={isLoading}
                                    >
                                        Sign in
                                    </button>
                                </p>
                            )}
                        </form>
                    </div>
                    <Link to="/about" className="SkLogin-aboutPromo">
                        <span className="SkLogin-aboutPromoTitle">Discover Skeepto</span>
                        <span className="SkLogin-aboutPromoText">
                            Native units, Excel import, collaboration, file versioning — and an
                            open-source partnership opportunity.
                        </span>
                        <span className="SkLogin-aboutPromoAction">Read more →</span>
                    </Link>
                    </div>
                </main>

                <footer className="SkLogin-footer">
                    <span className="SkLogin-footerCopy">
                        Copyright Stéphane ALLEZ 2026 licence MIT
                    </span>
                </footer>
            </div>
        );
    }
}

export default SkLogin;
