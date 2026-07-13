import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'cronFormat',
  standalone: true,
})
export class CronFormatPipe implements PipeTransform {
  transform(cronExpression: string | null | undefined): string {
    if (!cronExpression) return 'N/A';

    const parts = cronExpression.trim().split(' ');
    if (parts.length < 5) return cronExpression;

    const [minute, hour, day, month, dayOfWeek] = parts;

    // Every N minutes
    if (minute.startsWith('*/')) {
      const interval = minute.substring(2);
      if (hour === '*' && day === '*' && month === '*' && dayOfWeek === '*') {
        return `Every ${interval} min`;
      }
    }

    // Every N hours
    if (minute === '0' && hour.startsWith('*/')) {
      const interval = hour.substring(2);
      if (day === '*' && month === '*' && dayOfWeek === '*') {
        return `Every ${interval} hrs`;
      }
    }

    // Daily at midnight
    if (minute === '0' && hour === '0' && day === '*' && month === '*' && dayOfWeek === '*') {
      return 'Daily at midnight';
    }

    // Daily at specific hour
    if (minute === '0' && !hour.includes('*') && day === '*' && month === '*' && dayOfWeek === '*') {
      return `Daily at ${hour}:00`;
    }

    // Monthly
    if (minute === '0' && hour === '0' && day === '1' && month === '*' && dayOfWeek === '*') {
      return 'Monthly (1st)';
    }

    // Weekdays
    if (dayOfWeek === '1-5' && day === '*' && month === '*') {
      return minute === '0' && !hour.includes('*') ? `Weekdays at ${hour}:00` : 'Weekdays';
    }

    // Default: show simplified cron
    return cronExpression.length > 20 ? cronExpression.substring(0, 20) + '...' : cronExpression;
  }
}

