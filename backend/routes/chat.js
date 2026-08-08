const express = require('express');
const router = express.Router();
const Chat = require('../models/Chat');
const Message = require('../models/Message');

// @route   POST /api/chat
// @desc    Access or create a 1-on-1 chat
router.post('/', async (req, res) => {
  const { userId, targetUserId } = req.body;

  if (!userId || !targetUserId) {
    return res.status(400).json({ error: 'Both user IDs are required' });
  }

  try {
    let isChat = await Chat.find({
      isGroupChat: false,
      $and: [
        { users: { $elemMatch: { $eq: userId } } },
        { users: { $elemMatch: { $eq: targetUserId } } },
      ],
    })
      .populate('users', '-password')
      .populate('latestMessage');

    if (isChat.length > 0) {
      res.status(200).json(isChat[0]);
    } else {
      const chatData = {
        chatName: 'sender',
        isGroupChat: false,
        users: [userId, targetUserId],
      };

      const createdChat = await Chat.create(chatData);
      const fullChat = await Chat.findOne({ _id: createdChat._id }).populate(
        'users',
        '-password'
      );
      res.status(201).json(fullChat);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// @route   POST /api/chat/message
// @desc    Send a new message
router.post('/message', async (req, res) => {
  const { sender, recipient, text, chatId } = req.body;

  if (!sender || !text || !chatId) {
    return res.status(400).json({ error: 'Missing required message fields' });
  }

  try {
    let newMessage = {
      sender,
      recipient,
      text,
    };

    let message = await Message.create(newMessage);
    message = await message.populate('sender', 'username profilePic');

    await Chat.findByIdAndUpdate(chatId, { latestMessage: message });

    res.status(201).json(message);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// @route   GET /api/chat/messages/:chatId
// @desc    Get all messages for a specific chat
router.get('/messages/:chatId', async (req, res) => {
  try {
    const messages = await Message.find({ chatId: req.params.chatId })
      .populate('sender', 'username profilePic')
      .sort({ createdAt: 1 });

    res.status(200).json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

