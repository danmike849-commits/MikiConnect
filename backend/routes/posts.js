const express = require('express');
const router = express.Router();
const Post = require('../models/Post');

// @route   POST /api/posts
// @desc    Create a new post
router.post('/', async (req, res) => {
  try {
    const { user, text, image } = req.body;

    const newPost = new Post({
      user,
      text,
      image: image || '',
    });

    const post = await newPost.save();
    res.status(201).json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// @route   GET /api/posts
// @desc    Get all posts (Home Feed)
router.get('/', async (req, res) => {
  try {
    const posts = await Post.find()
      .populate('user', 'username profilePic')
      .sort({ createdAt: -1 });

    res.status(200).json(posts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
