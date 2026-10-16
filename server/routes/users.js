const express = require('express');
const userController = require('../controllers/userController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/', userController.list);
router.post('/', requireRole('admin'), userController.create);
router.patch('/:id', requireRole('admin'), userController.update);
router.delete('/:id', requireRole('admin'), userController.remove);

module.exports = router;
