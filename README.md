# ProjectileTrajectorySimulator
link here:
https://justin16chen.github.io/ProjectileTrajectorySimulator/

## Overview
This is a website to create your own physics-based launcher capable of 
- shooting on the move
- accurate hood compensation for velocity drop on the shooter wheel

All of the physics calculations are done on this website to reduce strain on the robot code. The final product of this website is a series of JSON files containing trajectory data that the robot code uses. Specifically, the robot code runs a series of interpolated lookup tables on the trajectories this website will help you generate.

The physics inside this website models 3 forces: gravity, drag, and magnus (spin), and requires 3 tuned values:
1. shooter speed -> exit speed (meters per second) conversion
2. drag coefficient
3. magnus coefficient

## Tuning process
### Recording videos
1. Record 5-10 videos of robot shooting balls
   - Camera should face perpendicular to trajectory of ball to minimize perspective distortion
   - Lay meterstick parallel to exit position of ball (needed later)
   - Make sure to vary shooter speed and hood angle in recordings. Record at the highest FPS possible for best results and easiest tuning
   - Some of these videos will go to tuning the 3 values, some will go to validate the 3 values to make sure they are accurate
   - Make sure camera is static throughout the duration of the video. If not, it will be impossible to tune you drag and magnus coefficients
### Tuning shooter speed -> exit speed conversion
2. Upload the videos into the ProjectileTrajectorySimulator website
3. Go through the videos frame-by-frame and plot the positions of the balls
4. Drag the virtual yellow meterstick and match it with the meterstick in the video
5. Go to System Identification -> Empirical Testing. Specify the FPS of your video there
6. Use the exit speed calculated to create regression to convert shooter speed to exit speed (will need data from multiple videos)
   - exit speed calculation finds the pixel distance between the first two points plotted
   - then converts pixel to meters using meterstick
   - then divides distance by time passed calculated using FPS
### Tuning drag and magnus coefficients
5. Go to System Identification -> Simulation
6. Specify a launch point (tab on right)
7. Click show simulation
   - If it is greyed out, look at the instructions below the button to find what you still need to do
8. Specify the exit speed and exit angle of the trajectory
9. Tune drag and magnus coeffients until simulation trajectory matches points plotted in video
10. Repeat for at least 3 videos, take the average drag and magnus coefficients
   - Validate your drag and magnus coefficients by plotting points for a new trajectory, use your existing coefficients, and see how close it is
### Generating trajectories
11. Go to Trajectory Generation
12. In the left panel, specify:
   - Range of distance you will be shooting from
   - Height offset from the goal to your exit position
   - ### IMPORTANT this is not the height of the goal. It is the height of the goal - height of your exit position
   - Existing drag and magnus coefficients
   - Exit Angle, Impact Angle, and Exit speed sliders
   - Step sizes for angle and velocity (smaller step sizes give you more trajectories)
13. Click Generate Trajectories
### Refining and exporting trajectories
14. The right panel shows all generated trajectories. Each tab shows all the trajectories corresponding to a certain goal. You can copy, refine, delete, or manually add trajectories. Sometimes there will be gaps in the generated trajectories. You may either regenerate them with smaller step sizes for velocity, or manually add in the missing ones. 
15. Once you are satisfied, click download all trajectories, and it will download a series of JSON files. Each JSON file contains info for all the trajectories corresponding to a certain goal

## Helpful Tips
To fill in missing trajectories, simply copy an existing one, edit the exit angle, then hover over the trajectory and click the refine icon (looks like a repeat icon) to the right. This will automatically adjust the trajectory to accurately hit the goal.  

When refining trajectories, you may choose to keep either the angle or the speed of the trajectory constant. Normally you would keep angle constant.
By default the Threshold for trajectory accuracy is 0.001 meters (1 mm). You may change this to be more or less accurate to your preference
