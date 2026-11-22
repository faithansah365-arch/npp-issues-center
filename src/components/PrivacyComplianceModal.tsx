import { useEffect, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { apiRequest } from '../lib/api';

interface PrivacyMeta {
  title: string;
  body: string;
  retentionDays: number;
  maxAttachmentMb: number;
  ghanaDpaChecklist: {
    dpaRegistrationReviewed: boolean;
    lawfulBasisDocumented: boolean;
    retentionPolicyApproved: boolean;
    officerTrainingCompleted: boolean;
    breachResponsePlanActive: boolean;
  } | null;
}

export function PrivacyComplianceModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<PrivacyMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    apiRequest<PrivacyMeta>('/api/meta/privacy')
      .then(setData)
      .catch((err) => setError((err as Error).message));
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-modal-title"
    >
      <div className="bg-white w-full sm:max-w-xl rounded-t-3xl sm:rounded-2xl border border-slate-200 max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-blue-800 shrink-0" />
            <h2 id="privacy-modal-title" className="text-base font-semibold text-slate-900">
              {data?.title || 'Privacy & Data Protection Notice'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            aria-label="Close privacy notice"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5 text-sm text-slate-700 leading-relaxed">
          {error && (
            <p className="text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              {error}
            </p>
          )}
          {data && (
            <>
              <div className="whitespace-pre-line">{data.body}</div>

              <div className="border-t border-slate-200 pt-4 space-y-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  Configured Retention & Upload Limits
                </h3>
                <p className="text-xs text-slate-600 tabular-nums">
                  Record retention schedule: {data.retentionDays} days · Maximum private attachment size: {data.maxAttachmentMb} MB (JPEG, PNG, WEBP, PDF only).
                </p>
              </div>

              {data.ghanaDpaChecklist && (
                <div className="border-t border-slate-200 pt-4 space-y-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Pre-Launch Ghana Data Protection Act, 2012 (Act 843) Review
                  </h3>
                  <ul className="space-y-1.5 text-xs text-slate-600">
                    <li>
                      Data Protection Commission registration reviewed:{' '}
                      <strong className="text-slate-900">
                        {data.ghanaDpaChecklist.dpaRegistrationReviewed ? 'Confirmed' : 'Pending review'}
                      </strong>
                    </li>
                    <li>
                      Lawful basis & internal party mandate documented:{' '}
                      <strong className="text-slate-900">
                        {data.ghanaDpaChecklist.lawfulBasisDocumented ? 'Confirmed' : 'Pending review'}
                      </strong>
                    </li>
                    <li>
                      Retention & disposal schedule approved:{' '}
                      <strong className="text-slate-900">
                        {data.ghanaDpaChecklist.retentionPolicyApproved ? 'Confirmed' : 'Pending review'}
                      </strong>
                    </li>
                    <li>
                      Executive confidentiality & minimum-data briefing completed:{' '}
                      <strong className="text-slate-900">
                        {data.ghanaDpaChecklist.officerTrainingCompleted ? 'Confirmed' : 'Pending review'}
                      </strong>
                    </li>
                    <li>
                      Security incident & breach notification protocol active:{' '}
                      <strong className="text-slate-900">
                        {data.ghanaDpaChecklist.breachResponsePlanActive ? 'Confirmed' : 'Pending review'}
                      </strong>
                    </li>
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-5 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            Close Notice
          </button>
        </div>
      </div>
    </div>
  );
}
