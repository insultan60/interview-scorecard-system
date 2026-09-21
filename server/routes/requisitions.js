const express = require('express');
const requisitionController = require('../controllers/requisitionController');
const { requireAuth } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

const router = express.Router();

// Public routes for candidate self-application (no auth required)
router.get('/:id/public', requisitionController.getPublic);
router.post('/:id/apply', upload.single('resume'), requisitionController.applyPublic);

// Authenticated routes below
router.use(requireAuth);

router.post('/generate-field', requisitionController.generateField);
router.post('/', requisitionController.create);
router.get('/', requisitionController.list);
router.get('/:id', requisitionController.getOne);
router.patch('/:id', requisitionController.update);
router.delete('/:id', requisitionController.remove);
router.post('/:id/generate-scorecard', requisitionController.generateScorecard);
router.post('/:id/clone-scorecard', requisitionController.cloneScorecard);
router.patch('/:id/scorecard', requisitionController.updateScorecard);
router.get('/:id/ranking', requisitionController.ranking);

module.exports = router;
