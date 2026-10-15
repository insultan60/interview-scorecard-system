const express = require('express');
const departmentController = require('../controllers/departmentController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/', departmentController.list);
router.post('/', departmentController.create);
router.patch('/:id', departmentController.update);
router.delete('/:id', departmentController.remove);

module.exports = router;
