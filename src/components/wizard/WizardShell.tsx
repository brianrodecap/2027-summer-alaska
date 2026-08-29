import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Step from '@mui/material/Step';
import StepContent from '@mui/material/StepContent';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import { type ReactNode, useState } from 'react';

import type { WizardStepId } from '../../model/editForms';
import { WIZARD_STEP_LABEL, WIZARD_STEP_TIP } from '../../model/editForms';

export interface WizardStep {
  id: WizardStepId;
  content: ReactNode;
  // Gates the Next/Finish button for this step — most steps have nothing
  // required (the underlying applyXyzForm is what actually enforces it at
  // save time), so this defaults to true rather than every step needing to
  // opt in.
  canProceed?: boolean;
}

// Shared chrome for both the "Add to this day" wizard (kind undecided at
// the start) and the guided Edit wizard (kind already fixed) — a vertical
// MUI Stepper with each step's own field content directly underneath its
// label, Back/Next buttons inline per MUI's own vertical-stepper pattern,
// and a Cancel plus optional Delete floating below the whole thing. `steps`
// is recomputed by the caller on every relevant field change (branching on
// meal-decided-vs-undecided, whether a route was picked, etc.) — this
// component just clamps the current position back into range whenever that
// list gets shorter out from under it.
export function WizardShell({
  title,
  steps,
  onCancel,
  onFinish,
  finishLabel,
  error,
  onDismissError,
  deleteSlot,
}: {
  title: string;
  steps: WizardStep[];
  onCancel: () => void;
  onFinish: () => void;
  finishLabel: string;
  error: string | null;
  onDismissError: () => void;
  deleteSlot?: ReactNode;
}) {
  // Raw vs. clamped: `steps` can shrink out from under an in-progress
  // position (e.g. flipping a meal from "still deciding" back to "decided"
  // drops the mealOptions step), so what's actually rendered clamps back
  // into range on every render rather than needing an effect to reconcile
  // the two after the fact.
  const [rawActiveStep, setRawActiveStep] = useState(0);
  const activeStep = Math.min(rawActiveStep, steps.length - 1);
  const isLastStep = activeStep === steps.length - 1;

  return (
    <Dialog open onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={onDismissError}>
            {error}
          </Alert>
        )}
        <Stepper activeStep={activeStep} orientation="vertical" nonLinear>
          {steps.map((step, index) => (
            <Step key={step.id}>
              <StepLabel
                onClick={() => {
                  if (index < activeStep) setRawActiveStep(index);
                }}
                sx={index < activeStep ? { cursor: 'pointer' } : undefined}
              >
                {WIZARD_STEP_LABEL[step.id]}
              </StepLabel>
              <StepContent>
                {WIZARD_STEP_TIP[step.id] && (
                  <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
                    {WIZARD_STEP_TIP[step.id]}
                  </Alert>
                )}
                {step.content}
                <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
                  <Button onClick={onCancel}>Cancel</Button>
                  <Box sx={{ flex: 1 }} />
                  {index > 0 && <Button onClick={() => setRawActiveStep(index - 1)}>Back</Button>}
                  {isLastStep ? (
                    <Button variant="contained" onClick={onFinish}>
                      {finishLabel}
                    </Button>
                  ) : (
                    <Button
                      variant="contained"
                      disabled={step.canProceed === false}
                      onClick={() => setRawActiveStep(index + 1)}
                    >
                      Next
                    </Button>
                  )}
                </Box>
              </StepContent>
            </Step>
          ))}
        </Stepper>
        {deleteSlot}
      </DialogContent>
    </Dialog>
  );
}
