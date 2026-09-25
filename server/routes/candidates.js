const express = require('express');
const candidateController = require('../controllers/candidateController');
const { requireAuth } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

const router = express.Router();

router.use(requireAuth);

router.get('/', candidateController.list);
router.post('/', upload.single('resume'), candidateController.create);
router.post('/bulk', candidateController.bulkCreate);
router.get('/:id', candidateController.getOne);
router.patch('/:id', upload.single('resume'), candidateController.update);
router.post('/:id/apply', candidateController.apply);
router.delete('/:id/requisitions/:requisitionId', candidateController.removeFromRequisition);
router.delete('/:id', candidateController.remove);

module.exports = router;
