import { Download, FileText } from "lucide-react";
import type { PatientMedicalAttachment, PatientProfile } from "@/firebase/teleRehab";
import { cn } from "@/lib/utils";

interface PatientMedicalDetailsViewProps {
  profile: PatientProfile;
  className?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PatientMedicalDetailsView({ profile, className }: PatientMedicalDetailsViewProps) {
  const details = profile.medicalDetails;
  const attachments = Object.values(details?.attachments || {}).filter(
    (attachment): attachment is PatientMedicalAttachment => !!attachment?.dataUrl
  );

  return (
    <section
      aria-label={`Medical details for ${profile.name}`}
      className={cn("space-y-4 border-t border-slate-800 pt-4", className)}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="min-h-16 rounded-md border border-slate-800 bg-slate-950/70 p-3">
          <p className="text-[10px] font-bold uppercase text-slate-500">Name</p>
          <p className="mt-1 text-sm text-slate-200">{profile.name || ""}</p>
        </div>
        <div className="min-h-16 rounded-md border border-slate-800 bg-slate-950/70 p-3">
          <p className="text-[10px] font-bold uppercase text-slate-500">Age</p>
          <p className="mt-1 text-sm text-slate-200">{details?.age ?? ""}</p>
        </div>
        <div className="min-h-16 rounded-md border border-slate-800 bg-slate-950/70 p-3">
          <p className="text-[10px] font-bold uppercase text-slate-500">Disease Type</p>
          <p className="mt-1 text-sm text-slate-200">{details?.diseaseType || ""}</p>
        </div>
      </div>

      <div className="min-h-24 rounded-md border border-slate-800 bg-slate-950/70 p-3">
        <p className="text-[10px] font-bold uppercase text-slate-500">Previous History</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
          {details?.previousHistory || ""}
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-bold uppercase text-slate-500">Uploaded Records</p>
        {attachments.length > 0 && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {attachments.map((attachment) => (
              <a
                key={attachment.id}
                href={attachment.dataUrl}
                download={attachment.name}
                className="flex min-w-0 items-center gap-3 rounded-md border border-slate-800 bg-slate-950/70 p-3 text-left transition-colors hover:border-indigo-500/50 hover:bg-slate-900"
              >
                <FileText className="h-4 w-4 shrink-0 text-indigo-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-slate-200">{attachment.name}</span>
                  <span className="block text-[10px] text-slate-500">{formatFileSize(attachment.size)}</span>
                </span>
                <Download className="h-4 w-4 shrink-0 text-slate-500" />
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
