const express = require('express');
const candidateController = require('../controllers/candidateController');
const { requireAuth } = require('../middleware/auth');
const { uploadPdf } = require('../middleware/upload');

const router = express.Router();

router.use(requireAuth);

router.get('/', candidateController.list);
router.post('/', uploadPdf('resume'), candidateController.create);
router.post('/bulk', candidateController.bulkCreate);
router.post('/bulk-attach', candidateController.bulkAttach);
router.post('/send-onboarding-form', candidateController.sendOnboardingForm);
router.get('/:id', candidateController.getOne);
router.patch('/:id', uploadPdf('resume'), candidateController.update);
router.post('/:id/apply', candidateController.apply);
router.delete('/:id/requisitions/:requisitionId', candidateController.removeFromRequisition);
router.delete('/:id', candidateController.remove);

module.exports = router;
