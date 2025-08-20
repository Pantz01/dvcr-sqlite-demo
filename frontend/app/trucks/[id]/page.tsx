"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";

type Issue = {
  id: number;
  description: string;
  note?: string;
  resolved: boolean;
  resolved_at?: string;
  created_at: string;
  photos?: string[];
};

type Service = {
  id: number;
  service_type: string;
  odometer: number;
  created_at: string;
};

export default function TruckDetailPage() {
  const { id } = useParams();
  const truckId = id as string;

  const [truck, setTruck] = useState<any>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [issue, setIssue] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/trucks/${truckId}`)
      .then((res) => res.json())
      .then(setTruck);

    fetch(`/api/trucks/${truckId}/issues`)
      .then((res) => res.json())
      .then(setIssues);

    fetch(`/api/trucks/${truckId}/services`)
      .then((res) => res.json())
      .then(setServices);
  }, [truckId]);

  async function addIssueWithPhotos(e: React.FormEvent) {
    e.preventDefault();
    const formData = new FormData();
    formData.append("description", issue);
    formData.append("note", note);
    if (files) {
      for (let i = 0; i < files.length; i++) {
        formData.append("photos", files[i]);
      }
    }
    await fetch(`/api/trucks/${truckId}/issues`, {
      method: "POST",
      body: formData,
    });
    setIssue("");
    setNote("");
    if (fileRef.current) fileRef.current.value = "";
    setFiles(null);

    const updated = await fetch(`/api/trucks/${truckId}/issues`).then((r) =>
      r.json()
    );
    setIssues(updated);
  }

  async function addService(e: React.FormEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    await fetch(`/api/trucks/${truckId}/services`, {
      method: "POST",
      body: formData,
    });
    form.reset();
    const updated = await fetch(`/api/trucks/${truckId}/services`).then((r) =>
      r.json()
    );
    setServices(updated);
  }

  const activeIssues = issues.filter((i) => !i.resolved);
  const resolvedIssues = issues.filter((i) => i.resolved);

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-lg font-semibold">Truck #{truck?.number}</h1>

      {/* Add Issue */}
      <div className="border rounded-lg p-2 space-y-1">
        <div className="font-medium text-sm mb-1">Add Issue</div>
        <form onSubmit={addIssueWithPhotos} className="grid md:grid-cols-6 gap-1">
          <input
            value={issue}
            onChange={(e) => setIssue(e.target.value)}
            placeholder="Issue"
            className="border p-1 rounded text-xs col-span-2"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note"
            className="border p-1 rounded text-xs col-span-2"
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="border p-1 rounded text-xs col-span-1"
            onChange={(e) => setFiles(e.currentTarget.files)}
          />
          <button className="border rounded px-2 py-0.5 text-xs hover:bg-gray-100">
            Add
          </button>
        </form>
      </div>

      {/* Add Service */}
      <div className="border rounded-lg p-2 space-y-1">
        <div className="font-medium text-sm mb-1">Add Service</div>
        <form onSubmit={addService} className="grid md:grid-cols-3 gap-1">
          <select name="service_type" className="border p-1 rounded text-xs">
            <option value="oil">Oil change</option>
            <option value="chassis">Chassis lube</option>
          </select>
          <input
            name="odometer"
            placeholder="Odometer"
            className="border p-1 rounded text-xs"
            required
          />
          <button className="border rounded px-2 py-0.5 text-xs hover:bg-gray-100">
            Log
          </button>
        </form>
      </div>

      {/* Active Issues */}
      <div className="border rounded-lg p-2 space-y-2">
        <div className="font-medium text-sm">Active Issues</div>
        {activeIssues.length === 0 ? (
          <p className="text-xs text-gray-500">No active issues</p>
        ) : (
          <ul className="space-y-1">
            {activeIssues.map((i) => (
              <li
                key={i.id}
                className="border rounded p-2 text-xs flex justify-between items-center"
              >
                <span>
                  {i.description}{" "}
                  <span className="text-gray-500">
                    ({new Date(i.created_at).toLocaleDateString()})
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Resolved Issues */}
      <div className="border rounded-lg p-2 space-y-2">
        <div className="font-medium text-sm">Resolved Issues</div>
        {resolvedIssues.length === 0 ? (
          <p className="text-xs text-gray-500">No resolved issues</p>
        ) : (
          <ul className="space-y-1">
            {resolvedIssues.map((i) => (
              <li
                key={i.id}
                className="border rounded p-2 text-xs flex justify-between items-center"
              >
                <span>
                  {i.description}{" "}
                  <span className="text-gray-500">
                    (Resolved {i.resolved_at ? new Date(i.resolved_at).toLocaleDateString() : ""})
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Services */}
      <div className="border rounded-lg p-2 space-y-2">
        <div className="font-medium text-sm">Services</div>
        {services.length === 0 ? (
          <p className="text-xs text-gray-500">No services logged</p>
        ) : (
          <ul className="space-y-1">
            {services.map((s) => (
              <li
                key={s.id}
                className="border rounded p-2 text-xs flex justify-between items-center"
              >
                <span>
                  {s.service_type} @ {s.odometer} miles{" "}
                  <span className="text-gray-500">
                    ({new Date(s.created_at).toLocaleDateString()})
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
