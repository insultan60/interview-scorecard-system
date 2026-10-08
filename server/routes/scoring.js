const express = require('express');
const scoringController = require('../controllers/scoringController');
const { requireAuth } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

const router = express.Router();

router.use(requireAuth);

router.patch('/interview/:id/approve', scoringController.approve);
router.patch('/interview/:id/override', scoringController.override);
router.patch('/interview/:id/pass-fail', scoringController.passFail);
router.patch('/application/:id/override-initial-screening', scoringController.overrideInitialScreening);
router.post('/application/:id/recompute', scoringController.recompute);
router.patch('/application/:id/decision', scoringController.decision);
router.post('/application/:id/send-offer-letter', upload.single('offerLetter'), scoringController.sendOfferLetter);
router.patch('/application/:id/offer-letter-delivery', scoringController.recordOfferLetterDelivery);

module.exports = router;
