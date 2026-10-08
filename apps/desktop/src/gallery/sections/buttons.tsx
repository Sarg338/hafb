import { Button, IconButton } from '../../ui/Button.tsx';
import { Kbd } from '../../ui/Kbd.tsx';
import { Specimen, type GallerySection } from '../Gallery.tsx';

function Buttons() {
  return (
    <>
      <Specimen label="Primary">
        <Button variant="primary">Save</Button>
        <Button variant="primary" iconEnd="chevronDown">
          Assign
        </Button>
        <Button variant="primary" disabled>
          Fully funded
        </Button>
      </Specimen>
      <Specimen label="Secondary">
        <Button>Cancel</Button>
        <Button icon="edit">Edit Target</Button>
        <Button disabled>Unavailable</Button>
        <Button size="small" icon="add">
          Create Target
        </Button>
      </Specimen>
      <Specimen label="Toolbar">
        <Button variant="toolbar" icon="add">
          Category Group
        </Button>
        <Button variant="toolbar" icon="undo">
          Undo
        </Button>
        <Button variant="toolbar" icon="redo" disabled>
          Redo
        </Button>
        <Button variant="toolbar" icon="history">
          Recent Moves
        </Button>
      </Specimen>
      <Specimen label="Danger">
        <Button variant="danger" icon="dismiss">
          Delete 3 transactions
        </Button>
      </Specimen>
      <Specimen label="Icon buttons">
        <IconButton icon="chevronLeft" label="Previous month" />
        <IconButton icon="chevronRight" label="Next month" />
        <IconButton icon="eyeOff" iconSize={20} label="Hide amounts" />
        <IconButton icon="more" iconSize={20} label="Display options" />
        <IconButton icon="undo" label="Undo" shortcut="Ctrl+Z" />
        <IconButton icon="flag" label="Flag" aria-pressed="true" />
        <IconButton icon="dismiss" label="Close" size="small" />
        <IconButton icon="settings" label="Settings" disabled />
      </Specimen>
      <Specimen label="Shortcut chips">
        <Kbd keys="Ctrl+Z" />
        <Kbd keys="Ctrl+Shift+Z" />
        <Kbd keys="Ctrl+Enter" />
        <Kbd keys="?" />
      </Specimen>
    </>
  );
}

export const section: GallerySection = { id: 'buttons', title: 'Buttons', order: 10, Component: Buttons };
