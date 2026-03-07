const API = '/api/projects';

export async function fetchProjects() {
  const res = await fetch(API);
  return res.json();
}

export async function createProject(name = 'Untitled', canvas_w = 32, canvas_h = 32) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, canvas_w, canvas_h }),
  });
  return res.json();
}

export async function fetchProject(id: number) {
  const res = await fetch(`${API}/${id}`);
  return res.json();
}

export async function saveInstructions(id: number, instructions: unknown[]) {
  const res = await fetch(`${API}/${id}/instructions`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instructions }),
  });
  return res.json();
}
