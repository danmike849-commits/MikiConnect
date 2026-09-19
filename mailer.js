const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const sendVerificationEmail = async (recipientEmail, verificationToken) => {
    const verificationUrl = `https://mikiconnect.onrender.com/verify?token=${verificationToken}`;

    const mailOptions = {
        from: `"MikiConnect Support" <${process.env.EMAIL_USER}>`,
        to: recipientEmail,
        subject: 'Welcome to MikiConnect! Verify Your Email',
        html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                <h2 style="color: #4F46E5;">Welcome to MikiConnect!</h2>
                <p>Please verify your email address by clicking the button below:</p>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${verificationUrl}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Verify Email Address</a>
                </div>
            </div>
        `
    };

    await transporter.sendMail(mailOptions);
};

exports.sendVerificationEmail = sendVerificationEmail;
