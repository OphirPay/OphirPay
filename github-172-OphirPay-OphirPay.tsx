import React, { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  RadioGroup,
  FormControlLabel,
  Radio,
  TextField,
  Grid,
  Paper,
  Divider
} from '@mui/material';
import { addDays, addWeeks, addMonths, addYears, format } from 'date-fns';

type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

interface RecurringPaymentPickerProps {
  startDate?: Date;
  onChange?: (frequency: Frequency, nextRun: Date) => void;
}

const RecurringPaymentPicker: React.FC<RecurringPaymentPickerProps> = ({
  startDate = new Date(),
  onChange
}) => {
  const [frequency, setFrequency] = useState<Frequency>('monthly');

  const nextRunDate = useMemo(() => {
    switch (frequency) {
      case 'daily':
        return addDays(startDate, 1);
      case 'weekly':
        return addWeeks(startDate, 1);
      case 'monthly':
        return addMonths(startDate, 1);
      case 'yearly':
        return addYears(startDate, 1);
      default:
        return startDate;
    }
  }, [frequency, startDate]);

  const handleFrequencyChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newFrequency = event.target.value as Frequency;
    setFrequency(newFrequency);
    if (onChange) {
      onChange(newFrequency, nextRunDate);
    }
  };

  return (
    <Paper elevation={3} sx={{ p: 3, borderRadius: 2 }}>
      <Typography variant="h6" gutterBottom>
        Recurring Payment Settings
      </Typography>
      
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Typography variant="subtitle2" gutterBottom>
            Payment Frequency
          </Typography>
          <RadioGroup
            value={frequency}
            onChange={handleFrequencyChange}
            row
          >
            <FormControlLabel value="daily" control={<Radio size="small" />} label="Daily" />
            <FormControlLabel value="weekly" control={<Radio size="small" />} label="Weekly" />
            <FormControlLabel value="monthly" control={<Radio size="small" />} label="Monthly" />
            <FormControlLabel value="yearly" control={<Radio size="small" />} label="Yearly" />
          </RadioGroup>
        </Grid>

        <Grid item xs={12}>
          <Divider sx={{ my: 2 }} />
        </Grid>

        <Grid item xs={12}>
          <Typography variant="subtitle2" gutterBottom>
            Next Payment Date
          </Typography>
          <TextField
            type="date"
            value={format(startDate, 'yyyy-MM-dd')}
            onChange={(e) => {
              const newDate = new Date(e.target.value);
              // Recalculate next run when start date changes
              const newNextRun = useMemo(() => {
                switch (frequency) {
                  case 'daily':
                    return addDays(newDate, 1);
                  case 'weekly':
                    return addWeeks(newDate, 1);
                  case 'monthly':
                    return addMonths(newDate, 1);
                  case 'yearly':
                    return addYears(newDate, 1);
                  default:
                    return newDate;
                }
              }, [frequency, newDate]);
              
              if (onChange) {
                onChange(frequency, newNextRun);
              }
            }}
            fullWidth
            InputLabelProps={{ shrink: true }}
            sx={{ mb: 2 }}
          />
          <Box sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Next payment will be on: <strong>{format(nextRunDate, 'EEEE, MMMM d, yyyy')}</strong>
            </Typography>
          </Box>
        </Grid>
      </Grid>
    </Paper>
  );
};

export default RecurringPaymentPicker;