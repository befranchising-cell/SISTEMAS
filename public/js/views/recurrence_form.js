import { el, field, input, select } from '../ui.js';

const WD = [['1', 'Seg'], ['2', 'Ter'], ['3', 'Qua'], ['4', 'Qui'], ['5', 'Sex'], ['6', 'Sáb'], ['0', 'Dom']];

/**
 * Builds a recurrence configuration form (§7, §12). Returns { node, getConfig }.
 * getConfig() yields the object the /preview and /schedule endpoints expect.
 */
export function recurrenceForm(opts = {}) {
  const freqSel = select('frequency', [
    { value: 'daily', label: 'Diária' },
    { value: 'weekly', label: 'Semanal' },
    { value: 'biweekly', label: 'Quinzenal' },
    { value: 'monthly', label: 'Mensal' },
    { value: 'specific', label: 'Datas específicas' },
  ], opts.frequency || 'monthly');

  const startInput = input('startDate', opts.startDate || '', { type: 'date' });
  const endInput = input('endDate', opts.endDate || '', { type: 'date' });

  // Weekday chips (weekly/biweekly)
  const weekdayBox = el('div', { class: 'btn-row' });
  const weekdayState = new Set();
  for (const [val, label] of WD) {
    const b = el('button', { type: 'button', class: 'btn sm', text: label, 'data-wd': val, onClick: () => {
      if (weekdayState.has(val)) { weekdayState.delete(val); b.classList.remove('primary'); }
      else { weekdayState.add(val); b.classList.add('primary'); }
    } });
    weekdayBox.appendChild(b);
  }

  const monthDayInput = input('monthDays', opts.monthDays || '5', { placeholder: 'Ex.: 5 ou 5,20' });
  const specificInput = input('specificDates', '', { placeholder: 'AAAA-MM-DD, AAAA-MM-DD' });
  const weekendSel = select('weekendStrategy', [
    { value: 'keep', label: 'Manter data original' },
    { value: 'anticipate', label: 'Antecipar (fim de semana/feriado)' },
    { value: 'postpone', label: 'Adiar (fim de semana/feriado)' },
  ], 'keep');

  const weekdayField = field('Dias da semana', weekdayBox);
  const monthField = field('Dias do mês', monthDayInput);
  const specificField = field('Datas específicas', specificInput);

  function updateVisibility() {
    const f = freqSel.value;
    weekdayField.style.display = (f === 'weekly' || f === 'biweekly') ? '' : 'none';
    monthField.style.display = f === 'monthly' ? '' : 'none';
    specificField.style.display = f === 'specific' ? '' : 'none';
  }
  freqSel.addEventListener('change', updateVisibility);

  const node = el('div', {}, [
    el('div', { class: 'form-grid cols-3' }, [
      field('Periodicidade', freqSel),
      field('Data inicial *', startInput),
      field('Data final', endInput),
    ]),
    weekdayField, monthField, specificField,
    field('Quando cair em fim de semana/feriado', weekendSel),
  ]);
  updateVisibility();

  function getConfig() {
    const cfg = {
      frequency: freqSel.value,
      startDate: startInput.value,
      endDate: endInput.value || null,
      weekendStrategy: weekendSel.value,
    };
    if (freqSel.value === 'weekly' || freqSel.value === 'biweekly') cfg.weekdays = [...weekdayState].map(Number);
    if (freqSel.value === 'monthly') cfg.monthDays = monthDayInput.value.split(',').map((s) => Number(s.trim())).filter(Boolean);
    if (freqSel.value === 'specific') cfg.specificDates = specificInput.value.split(',').map((s) => s.trim()).filter(Boolean);
    return cfg;
  }

  return { node, getConfig };
}
