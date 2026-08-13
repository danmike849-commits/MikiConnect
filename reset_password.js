const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Put your MongoDB URI here or pull from environment
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error("Please set MONGO_URI or run with MONGO_URI='your_connection_string' node reset_password.js");
    process.exit(1);
}

const UserSchema = new mongoose.Schema({
    username: String,
    email: String,
    password: String
});

const User = mongoose.model('User', UserSchema);

async function resetPassword() {
    try {
        await mongoose.connect(MONGO_URI);
        const newPassword = "123456"; // Change this if you want a different password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        const updatedUser = await User.findOneAndUpdate(
            { username: "ADMIN" },
            { password: hashedPassword },
            { new: true }
        );

        if (updatedUser) {
            console.log("\n✅ SUCCESS: Password for user 'ADMIN' has been reset to: 123456\n");
        } else {
            console.log("\n❌ User 'ADMIN' was not found in the database.\n");
        }
        process.exit(0);
    } catch (err) {
        console.error("Error resetting password:", err);
        process.exit(1);
    }
}

resetPassword();
