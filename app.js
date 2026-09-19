const express = require('express');
const app = express();

const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

const { sendVerificationEmail } = require('./mailer');

app.use(express.json());

// Forgot Password Route
app.post('/api/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        
        // Generate a reset token (or use your existing token logic)
        const resetToken = 'sample-reset-token'; 

        // Send email using your Gmail transporter
        await sendVerificationEmail(email, resetToken);

        res.status(200).json({ 
            success: true, 
            message: 'If an account exists for that email, a password reset link has been sent.' 
        });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ success: false, message: 'Server error during password reset request.' });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`MikiConnect listening on ${PORT}`);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
