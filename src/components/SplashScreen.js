import React, { useState, useEffect } from 'react';

const SplashScreen = ({ onFinish, src, alt }) => {
    const [visible, setVisible] = useState(true);

    useEffect(() => {
        const timer = setTimeout(() => {
            setVisible(false);
            if (onFinish) onFinish();
        }, 1000);

        return () => clearTimeout(timer);
    }, [onFinish]);

    if (!visible) return null;

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'white',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 9999,
        }}>
            <img 
                src={src} 
                alt={alt || "Splash Screen"}
                style={{
                    maxWidth: '80%',
                    maxHeight: '80%',
                    objectFit: 'contain'
                }}
            />
        </div>
    );
};

export default SplashScreen; 